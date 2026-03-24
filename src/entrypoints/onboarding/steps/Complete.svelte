<script lang="ts">
  function closeTab() {
    window.close();
  }
</script>

<div class="complete">
  <div class="hero">
    <div class="checkmark">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M20 6L9 17L4 12"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
    <h2>You're all set!</h2>
    <p class="subtitle">Safetyper is ready to help you write better. Here's how to use it:</p>
  </div>

  <div class="steps">
    <div class="usage-step">
      <div class="step-number">1</div>
      <div class="step-content">
        <h3>Click into any text field</h3>
        <p>
          Navigate to any website and click on a text input, textarea, or content-editable area.
        </p>
      </div>
    </div>

    <div class="usage-step">
      <div class="step-number">2</div>
      <div class="step-content">
        <h3>Start typing</h3>
        <p>
          Write your text naturally. After a brief pause, the Safetyper icon will appear near your
          cursor.
        </p>
      </div>
    </div>

    <div class="usage-step">
      <div class="step-number">3</div>
      <div class="step-content">
        <h3>Review corrections</h3>
        <p>
          Click the icon to see grammar and spelling suggestions. Accept or dismiss them with one
          click.
        </p>
      </div>
    </div>
  </div>

  <div class="actions">
    <button class="primary-btn" onclick={closeTab}>Close & Start Writing</button>
  </div>
</div>

<style>
  .complete {
    max-width: 480px;
    margin: 0 auto;
    text-align: center;
  }

  .hero {
    margin-bottom: 32px;
  }

  .checkmark {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--st-success);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
  }

  h2 {
    font-size: 1.375rem;
    font-weight: 700;
    color: var(--st-text);
    margin-bottom: 8px;
  }

  .subtitle {
    font-size: 0.9375rem;
    color: var(--st-text-secondary);
  }

  .steps {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 32px;
    text-align: left;
  }

  .usage-step {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 16px;
    background: var(--st-bg-secondary);
    border: 1px solid var(--st-border);
    border-radius: 10px;
  }

  .step-number {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--st-brand-surface);
    color: var(--st-brand);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8125rem;
    font-weight: 700;
  }

  .step-content h3 {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--st-text);
    margin-bottom: 4px;
  }

  .step-content p {
    font-size: 0.8125rem;
    color: var(--st-text-secondary);
    line-height: 1.4;
  }

  .actions {
    display: flex;
    justify-content: center;
  }

  .primary-btn {
    width: 100%;
    max-width: 320px;
    padding: 12px 24px;
    background: var(--st-brand);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .primary-btn:hover {
    background: var(--st-brand-dark);
  }
</style>
