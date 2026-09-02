const TAP_PX = 14;
const TAP_MS = 280;
/** Halt for the Enter The Leela cue: 1.00s into Scene 2, not the end of Scene 1. */
const SCENE_TWO_CUE_AT = 1;

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
  function refreshDurations() {
    let cursor = 0;
    clips.forEach((clip) => {
      clip.duration = Math.max(0.05, clip.el.duration || 0);
      clip.start = cursor;
      clip.end = cursor + clip.duration;
      cursor = clip.end;
    });
    total = cursor;
    halts = [0, sceneTwoCueTime(), total];
  }

  function sceneTwoCueTime() {
    const start = clips[0]?.end || 0;
    const sceneTwo = clips[1]?.duration || 0;
    if (!sceneTwo) return start;
    return start + Math.min(SCENE_TWO_CUE_AT, Math.max(0.05, sceneTwo - 0.05));
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
    const el = clip.el;
    const target = clamp(localTime, 0, Math.max(0, clip.duration - 0.04));
    if (Math.abs((el.currentTime || 0) - target) < 0.07) return;
    try {
      el.pause();
      el.currentTime = target;
    } catch {
      /* Safari may reject until a user gesture */
    }
  }

  function pauseAll() {
    clips.forEach((clip) => {
      if (!clip.el.paused) clip.el.pause();
    });
  }

  function activateClip(index, local, playing) {
    clips.forEach((clip, i) => {
      const on = i === index;
      clip.el.classList.toggle("is-active", on);
      if (!on) {
        if (!clip.el.paused) clip.el.pause();
        return;
      }
      if (playing) {
        if (Math.abs((clip.el.currentTime || 0) - local) > 0.18) {
          try {
            clip.el.currentTime = local;
          } catch {
            /* ignore */
          }
        }
        clip.el.playbackRate = 1;
        if (clip.el.paused) clip.el.play().catch(() => {});
      } else {
        seekVideo(i, local);
      }
    });
  }

  function paint(t, playing = false) {
    activateClip(clipAt(t), t - clips[clipAt(t)].start, playing);
  }

  function emitHalt() {
    haltIndex = haltIndexFor(time);
    onHalt?.({
      time,
      total,
      haltIndex,
      atStart: time <= 0.04,
      atSceneTwo: Math.abs(time - sceneTwoCueTime()) < 0.12,
      atEnd: time >= total - 0.05,
    });
  }

  function setTime(next, { halt = false } = {}) {
    const previous = time;
    time = clamp(next, 0, total);
    paint(time);
    onTime?.(time, total);
    if (time >= total - 0.02 && !completed) {
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

  function finishCoast(dest) {
    window.clearInterval(coastTo.timer);
    cancelAnimationFrame(raf);
    pauseAll();
    if (dir > 0 && dest >= total - 0.02) {
      setTime(total);
      return;
    }
    setTime(dest, { halt: true });
  }

  function coastTo(target, direction) {
    dir = direction;
    mode = "coast";
    completed = false;
    const dest = clamp(target, 0, total);
    cancelAnimationFrame(raf);
    window.clearInterval(coastTo.timer);
    lastStamp = performance.now();
    let lastMedia = -1;
    let stalled = 0;
    const warmup = clipAt(time);
    if (direction > 0 && clips[warmup + 1]) {
      try {
        clips[warmup + 1].el.currentTime = 0;
      } catch {
        /* ignore */
      }
    }

    if (direction > 0) {
      const idx = clipAt(time);
      activateClip(idx, time - clips[idx].start, true);
    } else {
      pauseAll();
      paint(time);
    }

    const step = () => {
      if (mode !== "coast") {
        window.clearInterval(coastTo.timer);
        return;
      }
      const stamp = performance.now();
      const dt = Math.min(0.28, Math.max(0, (stamp - lastStamp) / 1000));
      lastStamp = stamp;

      if (dir > 0) {
        const idx = clipAt(time);
        const clip = clips[idx];
        const el = clip.el;
        clips.forEach((c, i) => c.el.classList.toggle("is-active", i === idx));
        const local = clamp(time - clip.start, 0, Math.max(0, clip.duration - 0.001));
        el.playbackRate = 1;
        if (Math.abs((el.currentTime || 0) - local) > 0.4) {
          try {
            el.currentTime = local;
          } catch {
            /* ignore */
          }
        }
        if (el.paused) el.play().catch(() => {});
        const mediaT = el.currentTime || 0;
        const ended = el.ended || mediaT >= clip.duration - 0.04;
        if (ended && dest > clip.end + 0.01) {
          time = clip.end + 0.001;
          lastMedia = -1;
          stalled = 0;
          el.pause();
          const nextIdx = clipAt(time);
          try {
            clips[nextIdx].el.currentTime = 0;
          } catch {
            /* ignore */
          }
          activateClip(nextIdx, 0, true);
        } else if (mediaT > lastMedia + 0.0008) {
          stalled = 0;
          lastMedia = mediaT;
          time = clip.start + mediaT;
        } else {
          stalled += dt;
          if (stalled > 0.22) {
            time += dt;
            try {
              el.currentTime = clamp(time - clip.start, 0, clip.duration - 0.04);
            } catch {
              /* ignore */
            }
          }
        }
      } else {
        pauseAll();
        time -= dt;
        const idx = clipAt(clamp(time, 0, total));
        seekVideo(idx, clamp(time, 0, total) - clips[idx].start);
        clips.forEach((c, i) => c.el.classList.toggle("is-active", i === idx));
      }

      time = clamp(time, 0, total);
      onTime?.(time, total);

      if ((dir > 0 && time >= dest - 0.02) || (dir < 0 && time <= dest + 0.02)) {
        finishCoast(dest);
      }
    };
    coastTo.timer = window.setInterval(step, 16);
    step();
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
    completed = false;
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
    window.clearInterval(coastTo.timer);
    pauseAll();
  }

  const pointers = new Map();

  function pxPerSecond() {
    return Math.max(220, window.innerHeight * 0.52);
  }

  function onPointerDown(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.set(event.pointerId, {
      y: event.clientY,
      t: time,
      startedAt: performance.now(),
      startY: event.clientY,
      lastY: event.clientY,
      lastDir: dir,
      dragging: false,
      wasCoasting: mode === "coast",
    });
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    const p = pointers.get(event.pointerId);
    if (!p) return;
    const dy = event.clientY - p.lastY;
    p.lastY = event.clientY;
    if (!p.dragging) {
      if (Math.abs(event.clientY - p.startY) < TAP_PX) return;
      p.dragging = true;
      stopCoast();
      mode = "dragging";
      completed = false;
      p.t = time;
      p.startY = event.clientY;
    }
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
    const isTap = !p.dragging && moved < TAP_PX && elapsed < TAP_MS;
    if (isTap && treatTap) {
      playForward();
      return;
    }
    if (isTap) {
      if (p.wasCoasting && mode === "coast") return;
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
    debug() {
      return {
        time,
        total,
        mode,
        dir,
        haltIndex,
        sceneTwoCue: sceneTwoCueTime(),
        halts: halts.slice(),
      };
    },
  };
}
