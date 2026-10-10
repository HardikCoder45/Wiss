import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoldToTalkGesture } from '../src/main/hotkey';

afterEach(() => vi.useRealTimers());

describe('HoldToTalkGesture', () => {
  it('starts after the hold threshold and stops on release', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const gesture = new HoldToTalkGesture({ activationKeys: [1, 2], holdDelayMs: 220, onStart: start, onStop: stop });
    gesture.keyDown(1);
    vi.advanceTimersByTime(219);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledOnce();
    expect(gesture.currentPhase).toBe('active');
    gesture.keyUp(1);
    expect(stop).toHaveBeenCalledOnce();
    expect(gesture.currentPhase).toBe('idle');
  });

  it('does not hijack a normal modifier shortcut', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const gesture = new HoldToTalkGesture({ activationKeys: [1], holdDelayMs: 220, onStart: start, onStop: stop });
    gesture.keyDown(1);
    gesture.keyDown(42);
    vi.advanceTimersByTime(500);
    expect(start).not.toHaveBeenCalled();
    gesture.keyUp(1);
    expect(stop).not.toHaveBeenCalled();
    expect(gesture.currentPhase).toBe('idle');
  });

  it('ignores duplicate activation keydown events', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const stop = vi.fn();
    const gesture = new HoldToTalkGesture({ activationKeys: [1], holdDelayMs: 50, onStart: start, onStop: stop });
    gesture.keyDown(1);
    gesture.keyDown(1);
    vi.advanceTimersByTime(50);
    expect(start).toHaveBeenCalledOnce();
    gesture.keyUp(1);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not pop the overlay when a key repeat lands after the keyup', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const gesture = new HoldToTalkGesture({ activationKeys: [1], holdDelayMs: 50, onStart: start, onStop: () => undefined });
    gesture.keyDown(1);
    vi.advanceTimersByTime(50);
    gesture.keyUp(1);
    // Auto-repeat for the still-logically-held key, delivered late.
    gesture.keyDown(1);
    vi.advanceTimersByTime(500);
    expect(start).toHaveBeenCalledOnce();
    expect(gesture.currentPhase).toBe('idle');
  });

  it('re-arms on a genuine second press after the repeat window', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const gesture = new HoldToTalkGesture({ activationKeys: [1], holdDelayMs: 50, onStart: start, onStop: () => undefined });
    gesture.keyDown(1);
    vi.advanceTimersByTime(50);
    gesture.keyUp(1);
    vi.advanceTimersByTime(60);
    gesture.keyDown(1);
    vi.advanceTimersByTime(50);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('releases even when the keyup carries the other modifier keycode', () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const gesture = new HoldToTalkGesture({ activationKeys: [1, 2], holdDelayMs: 50, onStart: () => undefined, onStop: stop });
    gesture.keyDown(1);
    vi.advanceTimersByTime(50);
    // macOS reports the right-hand Option under a different code than the left.
    gesture.keyUp(2);
    expect(stop).toHaveBeenCalledOnce();
    expect(gesture.currentPhase).toBe('idle');
  });
});
