<script lang="ts">
  interface Props {
    onNext: () => void;
    onSkip: () => Promise<void>;
  }

  let { onNext, onSkip }: Props = $props();
</script>

<div class="welcome">
  <div class="hero">
    <img src="/icon/128.png" width="64" height="64" alt="Safetyper" class="logo" />
    <h1>Welcome to Safetyper</h1>
    <p class="tagline">Privacy-focused grammar checker that keeps your data safe</p>
  </div>

  <div class="features">
    <div class="feature-card">
      <div class="feature-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <div class="feature-text">
        <h3>Private by Design</h3>
        <p>Your text is sent directly to your chosen AI provider. No middleman, no data storage.</p>
      </div>
    </div>

    <div class="feature-card">
      <div class="feature-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <div class="feature-text">
        <h3>Instant Corrections</h3>
        <p>Get real-time grammar and spelling fixes as you type across any website.</p>
      </div>
    </div>

    <div class="feature-card">
      <div class="feature-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="2" />
          <path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </div>
      <div class="feature-text">
        <h3>Works Everywhere</h3>
        <p>Compatible with any text field -- emails, documents, social media, and more.</p>
      </div>
    </div>

    <div class="feature-card">
      <div class="feature-icon">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" />
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <div class="feature-text">
        <h3>Choose Your Provider</h3>
        <p>Use OpenRouter, Groq, or a local Ollama instance -- you're in control.</p>
      </div>
    </div>
  </div>

  <div class="actions">
    <button class="primary-btn" onclick={onNext}>Get Started</button>
    <button class="skip-btn" onclick={onSkip}>Skip setup, I'll configure later</button>
  </div>
</div>

<style>
  .welcome {
    text-align: center;
  }

  .hero {
    margin-bottom: 32px;
  }

  .logo {
    margin-bottom: 16px;
    image-rendering: pixelated;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--st-text);
    margin-bottom: 8px;
  }

  .tagline {
    font-size: 0.9375rem;
    color: var(--st-text-secondary);
    max-width: 400px;
    margin: 0 auto;
  }

  .features {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 32px;
  }

  .feature-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    background: var(--st-bg-secondary);
    border: 1px solid var(--st-border);
    border-radius: 10px;
    text-align: left;
  }

  .feature-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--st-brand-surface);
    color: var(--st-brand);
    border-radius: 8px;
  }

  .feature-text h3 {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--st-text);
    margin-bottom: 4px;
  }

  .feature-text p {
    font-size: 0.75rem;
    color: var(--st-text-secondary);
    line-height: 1.4;
  }

  .actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .primary-btn {
    width: 100%;
    max-width: 320px;
    padding: 12px 24px;
    background: var(--st-btn-bg);
    color: #fff;
    border: 2px solid var(--st-btn-border);
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .primary-btn:hover {
    background: var(--st-btn-hover-bg);
  }

  .skip-btn {
    background: none;
    border: none;
    color: var(--st-text-secondary);
    font-size: 0.8125rem;
    cursor: pointer;
    padding: 4px 8px;
    transition: color 0.15s ease;
  }

  .skip-btn:hover {
    color: var(--st-text);
  }
</style>
