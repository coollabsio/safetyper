/**
 * The grammar icon must register even when stylesheet injection never returns.
 * Execute with `bun src/lib/content/content-boot.test.ts`.
 */

import { anchorIconPosition, iconTransformValue, type FieldBox } from './icon-placement';
import { startContentFeatures } from './content-boot';
import { shouldRunContentScript } from './page-guard';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function run(): Promise<void> {
  assert(
    shouldRunContentScript({
      href: 'https://example.com/',
      topFrame: true,
      sameOriginAncestors: true,
      editorDocument: false,
    }),
    'a normal page is allowed to start'
  );

  const order: string[] = [];
  let stylesSettled = false;
  await new Promise<void>((resolve, reject) => {
    startContentFeatures({
      injectStyles: () =>
        new Promise((settle) => {
          order.push('styles-started');
          setTimeout(() => {
            stylesSettled = true;
            settle();
          }, 50);
        }),
      listen: () => {
        order.push('listen');
      },
      prepareUi: async () => {
        order.push('prepare');
      },
      revealFocusedField: () => {
        order.push('icon');
        if (order.includes('listen') && !stylesSettled) resolve();
      },
    });
    setTimeout(() => reject(new Error('the icon was not shown before styles settled')), 30);
  });

  assert(order[0] === 'styles-started', 'style injection is requested');
  assert(order.includes('listen'), 'listeners attach');
  assert(
    order.indexOf('listen') < order.indexOf('icon'),
    'listeners exist before the icon is shown'
  );
  assert(!stylesSettled, 'the focused field gets an icon without waiting for CSS');

  const field: FieldBox = {
    left: 40,
    top: 133,
    width: 486,
    height: 126,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 2,
    paddingBottom: 2,
    rtl: false,
  };
  const transform = iconTransformValue(anchorIconPosition(field, 24));
  assert(
    transform !== 'translate(0px, 0px)',
    'the icon is anchored to the textarea, not the viewport corner'
  );
  const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(transform);
  assert(match !== null, 'the icon transform is written immediately');
  const left = Number(match?.[1]);
  const top = Number(match?.[2]);
  assert(
    left > field.left && left < field.left + field.width,
    'the icon sits inside the textarea horizontally'
  );
  assert(
    top > field.top && top < field.top + field.height,
    'the icon sits inside the textarea vertically'
  );
}

run()
  .then(() => {
    console.log('content boot tests passed');
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
