import { describe, expect, it } from 'vitest';
import { GAME_NAME } from '../src/index';

describe('scaffold', () => {
  it('exports the game name', () => {
    expect(GAME_NAME).toBe('MANHUNT');
  });
});
