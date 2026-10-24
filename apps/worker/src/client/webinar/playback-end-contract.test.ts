import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');

describe('webinar playback end contract', () => {
  it('finishes on the media ended event and stops live synchronization effects', () => {
    expect(source).toContain('onEnded={finishPlayback}');
    expect(source.match(/if \(!state\?\.live \|\| !joined \|\| ended\) return;/g)).toHaveLength(2);
    expect(source).toMatch(/finishPlayback\(\);\s+clearInterval\(timer\);/);
  });
});
