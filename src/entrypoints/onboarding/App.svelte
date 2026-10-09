<script lang="ts">
  import { onMount } from 'svelte';
  import { storage } from '#imports';
  import Welcome from './steps/Welcome.svelte';
  import Setup from './steps/Setup.svelte';
  import Complete from './steps/Complete.svelte';

  const hasCompletedOnboardingStorage = storage.defineItem<boolean>(
    'local:hasCompletedOnboarding',
    { fallback: false }
  );

  const darkModeStorage = storage.defineItem<boolean>('local:darkMode', {
    fallback: false,
  });

  let currentStep = $state(1);
  let darkMode = $state(false);

  function goNext() {
    if (currentStep < 3) currentStep++;
  }

  function goBack() {
    if (currentStep > 1) currentStep--;
  }

  async function skipOnboarding() {
    await hasCompletedOnboardingStorage.setValue(true);
    window.close();
  }

  function applyTheme(isDark: boolean) {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }

  async function toggleDarkMode() {
    darkMode = !darkMode;
    await darkModeStorage.setValue(darkMode);
    applyTheme(darkMode);
  }

  onMount(async () => {
    darkMode = (await darkModeStorage.getValue()) ?? false;
    applyTheme(darkMode);

    // If already completed, jump to final step
    const completed = await hasCompletedOnboardingStorage.getValue();
    if (completed) {
      currentStep = 3;
    }
  });
</script>

<main>
  <div class="top-bar">
    <button
      class="theme-toggle"
      onclick={toggleDarkMode}
      aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {#if darkMode}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="5" stroke="currentColor" stroke-width="2" />
          <path
            d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <span>Light</span>
      {:else}
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>Dark</span>
      {/if}
    </button>
  </div>

  <div class="progress-bar">
    {#each [1, 2, 3] as step (step)}
      <div
        class="progress-step"
        class:active={currentStep >= step}
        class:current={currentStep === step}
      >
        <div class="step-dot">{step}</div>
        <span class="step-label">
          {#if step === 1}Welcome{:else if step === 2}Setup{:else}Ready{/if}
        </span>
      </div>
      {#if step < 3}
        <div class="progress-line" class:active={currentStep > step}></div>
      {/if}
    {/each}
  </div>

  <div class="step-container">
    {#if currentStep === 1}
      <Welcome onNext={goNext} onSkip={skipOnboarding} />
    {:else if currentStep === 2}
      <Setup onNext={goNext} onBack={goBack} onSkip={skipOnboarding} />
    {:else}
      <Complete />
    {/if}
  </div>
</main>

<style>
  :global(html),
  :global(body) {
    background: var(--st-bg);
  }

  main {
    width: 100%;
    min-height: 100vh;
    padding: 0;
    font-family:
      'Geist Sans',
      Inter,
      -apple-system,
      BlinkMacSystemFont,
      sans-serif;
    background: var(--st-bg);
    color: var(--st-text);
  }

  .top-bar {
    display: flex;
    justify-content: flex-end;
    padding: 16px 24px;
  }

  .theme-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 2rem;
    padding: 0 0.625rem;
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--st-text-secondary);
    background: var(--st-btn-bg);
    border: 1px solid var(--st-btn-border);
    border-radius: 0.375rem;
    box-shadow: 0 2px 0 var(--st-btn-depth);
    cursor: pointer;
    transition-property: color, background-color, box-shadow, transform;
    transition-duration: 80ms;
  }

  .theme-toggle:hover {
    color: var(--st-text);
    background: var(--st-btn-hover-bg);
    transform: translateY(-1px);
    box-shadow: 0 3px 0 var(--st-btn-depth);
  }

  .theme-toggle:active {
    transform: translateY(2px);
    box-shadow: none;
  }

  .progress-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 24px 32px;
    gap: 0;
  }

  .progress-step {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }

  .step-dot {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 500;
    background: var(--st-bg-secondary);
    color: var(--st-text-muted);
    border: 2px solid var(--st-border);
    transition: all 0.2s ease;
  }

  .progress-step.active .step-dot {
    background: var(--st-primary-bg);
    color: var(--st-primary-text);
    border-color: var(--st-primary-border);
  }

  .progress-step.current .step-dot {
    box-shadow: 0 0 0 2px var(--st-focus-ring);
  }

  .step-label {
    font-size: 0.6875rem;
    font-weight: 500;
    color: var(--st-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .progress-step.active .step-label {
    color: var(--st-text);
  }

  .progress-line {
    width: 80px;
    height: 2px;
    background: var(--st-border);
    margin: 0 8px;
    margin-bottom: 20px;
    transition: background 0.2s ease;
  }

  .progress-line.active {
    background: var(--st-brand);
  }

  .step-container {
    padding: 0 24px 40px;
  }
</style>
