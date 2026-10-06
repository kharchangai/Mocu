import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Check, ExternalLink, LoaderCircle, RotateCw, Sparkles, Terminal } from 'lucide-react';
import { Settings } from './Settings';
import './FirstRunSetup.css';

type RuntimeStatus = {
  nodeInstalled: boolean;
  nodeVersion: string | null;
  pythonInstalled: boolean;
  pythonVersion: string | null;
};

type FirstRunSetupProps = {
  onComplete: () => Promise<void>;
};

export function FirstRunSetup({ onComplete }: FirstRunSetupProps) {
  const [step, setStep] = useState<'welcome' | 'settings'>('welcome');
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState('');
  const [isCompleting, setIsCompleting] = useState(false);

  const checkRuntimes = useCallback(async () => {
    setIsChecking(true);
    setError('');
    try {
      setRuntime(await invoke<RuntimeStatus>('check_system_runtimes'));
    } catch (checkError) {
      console.error('[First run] Runtime check failed:', checkError);
      setError('Could not check prerequisites. Please try again.');
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkRuntimes();
  }, [checkRuntimes]);

  const finishSetup = async () => {
    if (isCompleting) return;
    setIsCompleting(true);
    try {
      await onComplete();
    } catch (completeError) {
      console.error('[First run] Could not save setup completion:', completeError);
      setError('Could not save the initial setup. Please try again.');
      setIsCompleting(false);
    }
  };

  if (step === 'settings') {
    return (
      <div className="first-run-settings-shell" dir="ltr">
        <div className="first-run-settings-topbar">
          <button type="button" className="first-run-back" onClick={() => setStep('welcome')}>
            Back to setup
          </button>
          <span>Step 2 of 2 · Configure Mocu</span>
        </div>
        <Settings
          onClose={() => setStep('welcome')}
          onSaved={finishSetup}
        />
      </div>
    );
  }

  const nodeReady = runtime?.nodeInstalled ?? false;
  const pythonReady = runtime?.pythonInstalled ?? false;

  return (
    <main className="first-run-page" dir="ltr">
      <div className="first-run-card">
        <div className="first-run-brand">
          <span className="first-run-brand-icon"><Sparkles size={19} /></span>
          <span>Set up Mocu</span>
          <span className="first-run-step">Step 1 of 2</span>
        </div>

        <div className="first-run-hero-icon"><Terminal size={27} /></div>
        <p className="first-run-eyebrow">WELCOME</p>
        <h1>Let’s get Mocu ready</h1>
        <p className="first-run-intro">
          Mocu needs Node.js and Python to run some extensions. We checked whether they’re installed. If either is missing, use the official installation guide.
        </p>

        <section className="first-run-runtime-list" aria-label="Prerequisite status">
          <RuntimeRow
            name="Node.js"
            detail={nodeReady ? runtime?.nodeVersion ?? 'Installed' : 'Required to run Node.js extensions'}
            ready={nodeReady}
            checking={isChecking}
          >
            {!nodeReady && !isChecking ? (
              <button type="button" className="first-run-link" onClick={() => void openUrl('https://nodejs.org/en/download')}>
                Installation guide <ExternalLink size={14} />
              </button>
            ) : null}
          </RuntimeRow>
          <RuntimeRow
            name="Python"
            detail={pythonReady ? runtime?.pythonVersion ?? 'Installed' : 'Required to run Python extensions'}
            ready={pythonReady}
            checking={isChecking}
          >
            {!pythonReady && !isChecking ? (
              <button type="button" className="first-run-link" onClick={() => void openUrl('https://www.python.org/downloads/')}>
                Installation guide <ExternalLink size={14} />
              </button>
            ) : null}
          </RuntimeRow>
        </section>

        {error ? <p className="first-run-error" role="alert">{error}</p> : null}
        {!isChecking && (!nodeReady || !pythonReady) ? (
          <p className="first-run-note">
            To finish setup and run Mocu extensions, install both prerequisites. After installation, select “Check again.” On Windows, make sure to enable “Add Python to PATH” when installing Python. If you just installed them, you may need to restart Mocu.
          </p>
        ) : null}

        <div className="first-run-actions">
          <button type="button" className="first-run-secondary" onClick={() => void checkRuntimes()} disabled={isChecking}>
            {isChecking ? <LoaderCircle className="first-run-spinner" size={16} /> : <RotateCw size={16} />}
            Check again
          </button>
          <button type="button" className="first-run-primary" onClick={() => setStep('settings')} disabled={isChecking || !nodeReady || !pythonReady}>
            Continue to settings <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="first-run-footer">This is a one-time setup · You can revisit these options in Settings</p>
      </div>
    </main>
  );
}

type RuntimeRowProps = {
  name: string;
  detail: string;
  ready: boolean;
  checking: boolean;
  children?: ReactNode;
};

function RuntimeRow({ name, detail, ready, checking, children }: RuntimeRowProps) {
  return (
    <div className="first-run-runtime-row">
      <span className={`first-run-runtime-status ${checking ? 'is-checking' : ready ? 'is-ready' : 'is-missing'}`}>
        {checking ? <LoaderCircle className="first-run-spinner" size={17} /> : ready ? <Check size={17} /> : <span>!</span>}
      </span>
      <span className="first-run-runtime-copy">
        <strong>{name}</strong>
         <small>{checking ? 'Checking…' : detail}</small>
      </span>
      {children}
    </div>
  );
}
