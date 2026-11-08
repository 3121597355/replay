import assert from 'node:assert/strict';
import { COMPANION_ORIGIN, IMPORT_LIMIT, isCompanionMessage, validImportToken, validateDownloadBundle } from '../lib/download-import';
import { chooseDownloadSubtitle } from '../lib/download-subtitles';
import { episodeKey } from '../lib/pairing';
import { parseSubtitle } from '../lib/subtitle';

const video = new File(['video bytes'], 'Clip.mp4', { type: 'video/mp4' });
const english = new File(['1\n00:00:01,200 --> 00:00:02,400\nHello.\n'], 'Clip.eng.2.srt');
const chinese = new File(['1\n00:00:01,200 --> 00:00:02,400\n你好。\n'], 'Clip.zho.3.srt');
let passed = 0;
const check = async (name: string, fn: () => unknown) => { await fn(); passed++; console.log(`✓ ${name}`); };

void (async () => {
  await check('only accepts a real MP4 File and matching SRT Files', () => {
    assert.equal(validateDownloadBundle({ video, subtitles: [english, chinese] }).video, video);
    assert.throws(() => validateDownloadBundle({ video: { name: 'Clip.mp4', size: 10 }, subtitles: [] }));
    assert.throws(() => validateDownloadBundle({ video, subtitles: [new File(['wrong'], 'Other.eng.srt')] }));
    assert.throws(() => validateDownloadBundle({ video, subtitles: [new File(['script'], 'Clip.html')] }));
    assert.doesNotThrow(() => validateDownloadBundle({ video, subtitles: [] }));
  });
  await check('enforces the combined transfer size without allocating a giant fixture', () => {
    const large = new File(['x'], 'Clip.mp4');
    Object.defineProperty(large, 'size', { value: IMPORT_LIMIT + 1 });
    assert.throws(() => validateDownloadBundle({ video: large, subtitles: [] }), /500/);
  });
  await check('pins the local origin, source window and one-time import token', () => {
    const source = {} as Window;
    const token = '12345678-1234-1234-1234-123456789abc';
    const event = { source, origin: COMPANION_ORIGIN, data: { token, type: 'replay:files' } };
    assert.equal(isCompanionMessage(event, source, token), true);
    assert.equal(isCompanionMessage({ ...event, origin: 'https://attacker.example' }, source, token), false);
    assert.equal(isCompanionMessage({ ...event, source: {} as Window }, source, token), false);
    assert.equal(isCompanionMessage(event, source, 'other-token'), false);
    assert.equal(isCompanionMessage(event, null, token), false);
    assert(validImportToken(token)); assert(!validImportToken('../file'));
  });
  await check('pairs exported language/track suffixes with the source video', () => {
    for (const name of ['Clip.chi.2.srt', 'Clip.eng.3.srt', 'Clip.en-us.4.srt', 'Clip.zh-hans.5.srt']) {
      assert.equal(episodeKey(name), episodeKey(video.name));
    }
    assert.notEqual(episodeKey('Clip.2.srt'), episodeKey(video.name));
  });
  await check('merges Chinese/English only when every timestamp matches exactly', async () => {
    const result = await chooseDownloadSubtitle(video.name, [chinese, english]);
    const cues = parseSubtitle(result.selected!.text);
    assert.equal(cues[0].text, 'Hello.'); assert.equal(cues[0].native, '你好。');
    assert.equal(cues[0].start, 1.2); assert.equal(cues[0].end, 2.4);
    assert.equal(result.files.length, 3);
  });
  await check('keeps English and original tracks when translation timings differ', async () => {
    const different = new File(['1\n00:00:01,200 --> 00:00:02,420\n你好。\n'], 'Clip.zh.4.srt');
    const result = await chooseDownloadSubtitle(video.name, [different, english]);
    assert.equal(result.selected!.file, english); assert.equal(result.files.length, 2);
    assert.equal(parseSubtitle(result.selected!.text)[0].native, undefined);
  });
  await check('uses an existing bilingual track without replacing or shifting it', async () => {
    const bilingual = new File(['1\n00:00:01,200 --> 00:00:02,400\nHello.\n你好。\n'], 'Clip.chi.2.srt');
    const result = await chooseDownloadSubtitle(video.name, [english, bilingual]);
    assert.equal(result.selected!.file, bilingual);
  });
  await check('handles video-only imports and rejects unreadable SRT contents', async () => {
    assert.equal((await chooseDownloadSubtitle(video.name, [])).selected, null);
    await assert.rejects(chooseDownloadSubtitle(video.name, [new File(['bad text'], 'Clip.srt')]));
  });
  console.log(`${passed}/8 passed`);
})();
