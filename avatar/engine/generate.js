// Optional: ask an image model to draw the expression storyboard from the one
// portrait. Runs from the browser with the user's own Gemini API key (kept in
// this browser only). The engine works without it; generated frames become
// learned keyframes that replace the fitted shapes.

export const STORYBOARD = {
  joy: 'a warm, genuine smile with teeth showing, cheeks lifted, eyes slightly narrowed',
  surprise: 'surprised: eyebrows raised high, eyes wide open, mouth slightly open',
  sad: 'sad and empathetic: inner eyebrows raised, lips closed, mouth corners slightly down',
  concern: 'concerned and serious: brows drawn together, lips pressed, attentive eyes',
  think: 'thinking: eyes looking up and to the side, lips pressed together, one eyebrow slightly raised',
  aa: 'mouth wide open as if saying "aah", jaw dropped, upper teeth visible, eyes relaxed and looking at the camera',
  ee: 'saying "eee": lips stretched wide, teeth together and visible, eyes looking at the camera',
  oo: 'saying "ooo": lips rounded and pushed forward into a small circle, eyes looking at the camera',
};

const PROMPT = (description) => `Edit this portrait. Keep the exact same person, identity, hairstyle, clothing, background, lighting, camera angle, framing, head position and image size. Do not move or rotate the head. Change only the facial expression to: ${description}. Photorealistic if the original is a photo; keep the original art style if it is an illustration.`;

export async function generateExpression(canvas, name, { apiKey, model = 'gemini-2.5-flash-image' }) {
  const data = canvas.toDataURL('image/jpeg', 0.92).split(',')[1];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: 'image/jpeg', data } }, { text: PROMPT(STORYBOARD[name]) }] }], generationConfig: { responseModalities: ['IMAGE'] } }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message || `Image model request failed (${response.status}).`);
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error('The image model returned no image for this expression.');
  const image = new Image();
  image.src = `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
  await image.decode();
  return image;
}
