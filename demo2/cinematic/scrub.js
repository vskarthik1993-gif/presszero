const TAP_PX = 14;
const TAP_MS = 280;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createScrubber({
  videos,
  onHalt,
  onComplete,
  onTime,
}) {
  const clips = videos.map((el) => ({
    el,
    duration: 0,
    start: 0,
    end: 0,
  }));

  let total = 0;
  let time = 0;
  let mode = "halted";
  let dir = 1;
  let haltIndex = 0;
  let raf = 0;
  let lastStamp = 0;
  let halts = [0];
  let completed = false;
  const seekState = clips.map(() => ({ lock: false, pending: null }));

  function refreshDurations() {
    let cursor = 0;
    clips.forEach((clip) => {
      clip.duration = Math.max(0.05, clip.el.duration || 0);
      clip.start = cursor;
      clip.end = cursor + clip.duration;
      cursor = clip.end;
    });
    total = cursor;
    // Halt at the start, after scene 1, and (complete) at the very end.
    halts = [0, clips[0]?.end || 0, total];
  }

  function clipAt(t) {
    const last = clips.length - 1;
    for (let i = 0; i < clips.length; i += 1) {
      if (t < clips[i].end || i === last) return i;
    }
    return last;
  }

  function nextHalt(t, direction) {
    if (direction > 0) {
      const found = halts.find((h) => h > t + 0.02);
      return found == null ? total : found;
    }
    const found = [...halts].reverse().find((h) => h < t - 0.02);
    return found == null ? 0 : found;
  }

  function haltIndexFor(t) {
    let idx = 0;
    for (let i = 0; i < halts.length; i += 1) {
      if (Math.abs(t - halts[i]) < 0.04) return i;
      if (t >= halts[i] - 0.02) idx = i;
    }
    return idx;
  }

  function seekVideo(index, localTime) {
    const clip = clips[index];
    const state = seekState[index];
    const el = clip.el;
    const target = clamp(localTime, 0, Math.max(0, clip.duration - 0.04));
    state.pending = target;
    if (state.lock) return;
    if (Math.abs((el.currentTime || 0) - target) < 1 / 48) {
      state.pending = null;
      return;
    }
    state.lock = true;
    const finish = () => {
      state.lock = false;
      el.removeEventListener("seeked", finish);
      if (state.pending != null && Math.abs(el.currentTime - state.pending) > 1 / 48) {
        const again = state.pending;
        state.pending = null;
        seekVideo(index, again);
      } else {
        state.pending = null;
      }
    };
    el.addEventListener("seeked", finish, { once: true });
    try {
      el.pause();
      el.currentTime = target;
    } catch {
      state.lock = false;
    }
  }

  function paint(t) {
    const index = clipAt(t);
    clips.forEach((clip, i) => {
      const on = i === index;
      clip.el.classList.toggle("is-active", on);
      if (on) seekVideo(i, t - clip.start);
    });
  }

  function emitHalt() {
    haltIndex = haltIndexFor(time);
    onHalt?.({
      time,
      total,
      haltIndex,
      atStart: time <= 0.04,
      atSceneTwo: Math.abs(time - (clips[0]?.end || 0)) < 0.08,
      atEnd: time >= total - 0.05,
    });
  }

  function setTime(next, { halt = false } = {}) {
    const previous = time;
    time = clamp(next, 0, total);
    paint(time);
    onTime?.(time, total);
    if (time >= total - 0.02 && dir > 0 && !completed) {
      completed = true;
      mode = "halted";
      onComplete?.();
      return;
    }
    if (halt && !completed) {
      mode = "halted";
      emitHalt();
    }
    if (previous !== time && time <= 0.02) completed = false;
  }

  function coastTo(target, direction) {
    dir = direction;
    mode = "coast";
    const dest = clamp(target, 0, total);
    const tick = (stamp) => {
      if (mode !== "coast") return;
      if (!lastStamp) lastStamp = stamp;
      const dt = Math.min(0.05, (stamp - lastStamp) / 1000);
      lastStamp = stamp;
      const next = time + dir * dt;
      if ((dir > 0 && next >= dest) || (dir < 0 && next <= dest)) {
        setTime(dest, { halt: dest < total - 0.02 });
        return;
      }
      setTime(next);
      raf = requestAnimationFrame(tick);
    };
    lastStamp = 0;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }

  function playForward() {
    if (time >= total - 0.03) {
      onComplete?.();
      return;
    }
    const dest = nextHalt(time, 1);
    coastTo(dest, 1);
  }

  function playReverse() {
    if (time <= 0.03) {
      setTime(0, { halt: true });
      return;
    }
    const dest = nextHalt(time, -1);
    coastTo(dest, -1);
  }

  function stopCoast() {
    mode = "halted";
    cancelAnimationFrame(raf);
  }

  const pointers = new Map();

  function pxPerSecond() {
    return Math.max(220, window.innerHeight * 0.52);
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    stopCoast();
    mode = "dragging";
    completed = false;
    pointers.set(event.pointerId, {
      y: event.clientY,
      t: time,
      startedAt: performance.now(),
      startY: event.clientY,
      lastY: event.clientY,
      lastDir: dir,
    });
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    const p = pointers.get(event.pointerId);
    if (!p || mode !== "dragging") return;
    const dy = event.clientY - p.lastY;
    p.lastY = event.clientY;
    if (dy !== 0) p.lastDir = dy < 0 ? 1 : -1;
    const next = p.t + -(event.clientY - p.startY) / pxPerSecond();
    dir = p.lastDir;
    setTime(next);
  }

  function onPointerUp(event, { treatTap } = {}) {
    const p = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (!p) return;
    const elapsed = performance.now() - p.startedAt;
    const moved = Math.abs(event.clientY - p.startY);
    const isTap = moved < TAP_PX && elapsed < TAP_MS;
    if (isTap && treatTap) {
      playForward();
      return;
    }
    if (isTap) {
      mode = "halted";
      emitHalt();
      return;
    }
    const destination = nextHalt(time, p.lastDir);
    coastTo(destination, p.lastDir);
  }

  function onWheel(event) {
    event.preventDefault();
    stopCoast();
    completed = false;
    const next = time + event.deltaY / pxPerSecond();
    dir = event.deltaY < 0 ? 1 : -1;
    setTime(next);
    window.clearTimeout(onWheel._timer);
    onWheel._timer = window.setTimeout(() => {
      coastTo(nextHalt(time, dir), dir);
    }, 80);
  }

  async function prepare() {
    await Promise.all(
      clips.map(
        (clip) =>
          new Promise((resolve) => {
            const el = clip.el;
            el.muted = true;
            el.playsInline = true;
            el.setAttribute("playsinline", "");
            el.setAttribute("webkit-playsinline", "");
            el.preload = "auto";
            const ready = () => resolve();
            if (el.readyState >= 1 && el.duration) ready();
            else el.addEventListener("loadedmetadata", ready, { once: true });
            el.addEventListener("error", ready, { once: true });
          }),
      ),
    );
    refreshDurations();
    clips.forEach((clip) => {
      try {
        clip.el.pause();
        clip.el.currentTime = 0;
      } catch {
        /* Safari may reject until a user gesture */
      }
    });
    setTime(0, { halt: true });
  }

  return {
    prepare,
    playForward,
    playReverse,
    setTime,
    stopCoast,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onWheel,
    get time() {
      return time;
    },
    get total() {
      return total;
    },
    get mode() {
      return mode;
    },
    get haltIndex() {
      return haltIndex;
    },
  };
}
