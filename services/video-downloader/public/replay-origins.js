export const DEFAULT_REPLAY = 'https://www.replayen.com';
export const REPLAY_ORIGINS = Object.freeze([
  DEFAULT_REPLAY, 'https://replayen.com', 'https://replay-henna.vercel.app',
  'http://localhost:4310', 'http://127.0.0.1:4310',
  'http://localhost:4311', 'http://127.0.0.1:4311',
]);
export const isReplayOrigin = origin => REPLAY_ORIGINS.includes(origin);
export const isReplayToken = token => typeof token === 'string' && /^[a-f\d-]{32,64}$/i.test(token);

export function acceptsReplayMessage(event, source, origin, token) {
  return !!source && isReplayOrigin(origin) && isReplayToken(token)
    && event.origin === origin && event.source === source && event.data?.token === token;
}
