import { describe, expect, it } from 'vitest';
import { runSequentially } from './sequence';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('runSequentially', () => {
  it('does not start the next paragraph until the current one settles', async () => {
    const order: string[] = [];
    const gates = [deferred(), deferred()];
    let gate = 0;
    const pending = runSequentially(['a', 'b'], async (item) => {
      order.push(`start:${item}`);
      const current = gates[gate];
      gate += 1;
      await current.promise;
      order.push(`end:${item}`);
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['start:a']);
    gates[0].resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['start:a', 'end:a', 'start:b']);
    gates[1].resolve();
    await pending;
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });

  it('stops before a later paragraph when the check is aborted', async () => {
    const seen: string[] = [];
    let stop = false;
    await runSequentially(
      ['a', 'b'],
      async (item) => {
        seen.push(item);
        stop = true;
      },
      () => stop
    );
    expect(seen).toEqual(['a']);
  });
});
