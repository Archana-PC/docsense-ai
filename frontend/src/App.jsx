import React, { useState, useEffect, useRef } from 'react';
import { 
  Server, 
  Cpu, 
  Terminal, 
  Play, 
  RefreshCw, 
  Upload, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Copy,
  Check
} from 'lucide-react';
import './App.css';

function App() {
  // Step 1: Health check states
  const [backendStatus, setBackendStatus] = useState('loading'); // 'loading' | 'ok' | 'error'
  const [backendData, setBackendData] = useState(null);
  const [celeryStatus, setCeleryStatus] = useState('idle'); // 'idle' | 'triggering' | 'triggered' | 'error'
  const [celeryTasks, setCeleryTasks] = useState([]);
  const [logs, setLogs] = useState([]);

  // Step 2: Document upload and polling states
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [docStatus, setDocStatus] = useState('idle'); // 'idle' | 'uploading' | 'pending' | 'processing' | 'done' | 'failed'
  const [activeDocId, setActiveDocId] = useState(null);
  const [docDetails, setDocDetails] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const fileInputRef = useRef(null);
  const timerRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Helper to add log entries
  const addLog = (text, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ time: timestamp, text, type }, ...prev]);
  };

  // Check the general backend health endpoint
  const checkBackendHealth = async () => {
    setBackendStatus('loading');
    addLog('Initiating backend health check request...', 'info');
    try {
      const response = await fetch('/api/health/');
      if (response.ok) {
        const data = await response.json();
        setBackendStatus('ok');
        setBackendData(data);
        addLog(`Backend responded: ${JSON.stringify(data)}`, 'success');
      } else {
        throw new Error(`Server returned status: ${response.status}`);
      }
    } catch (err) {
      setBackendStatus('error');
      setBackendData({ error: err.message });
      addLog(`Backend health check failed: ${err.message}`, 'error');
    }
  };

  // Trigger the celery ping task
  const triggerCeleryTask = async () => {
    setCeleryStatus('triggering');
    addLog('Triggering background Celery dummy task...', 'info');
    try {
      const response = await fetch('/api/health/celery/');
      if (response.ok) {
        const data = await response.json();
        setCeleryStatus('triggered');
        setCeleryTasks(prev => [data, ...prev]);
        addLog(`Celery task dispatched. ID: ${data.task_id} (Status: ${data.status})`, 'success');
      } else {
        throw new Error(`Server returned status: ${response.status}`);
      }
    } catch (err) {
      setCeleryStatus('error');
      addLog(`Celery task dispatch failed: ${err.message}`, 'error');
    }
  };

  // Handle PDF file selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.lowerCase?.endsWith('.pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
      setErrorMsg('Only PDF files are allowed.');
      addLog('Rejected file selection: not a PDF.', 'error');
      setSelectedFile(null);
      return;
    }

    setErrorMsg(null);
    setSelectedFile(file);
    setDocStatus('idle');
    setDocDetails(null);
    addLog(`Selected file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'info');
  };

  // Start elapsed timer
  const startTimer = () => {
    setElapsedSeconds(0);
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
  };

  // Stop elapsed timer
  const stopTimer = () => {
    clearInterval(timerRef.current);
  };

  // Fetch full document details
  const fetchDocumentDetails = async (id) => {
    addLog(`Retrieving completed document ID: ${id}...`, 'info');
    try {
      const response = await fetch(`/api/documents/${id}/`);
      if (response.ok) {
        const data = await response.json();
        setDocDetails(data);
        addLog(`Successfully retrieved extracted text (${data.extracted_text ? data.extracted_text.length : 0} characters)`, 'success');
      } else {
        throw new Error('Failed to fetch document text.');
      }
    } catch (err) {
      addLog(`Failed to fetch document details: ${err.message}`, 'error');
    }
  };

  // Poll status endpoint
  const startPollingStatus = (id) => {
    setActiveDocId(id);
    startTimer();
    addLog(`Started polling status for document ID: ${id}`, 'info');

    clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/documents/${id}/status/`);
        if (response.ok) {
          const data = await response.json();
          setDocStatus(data.status);
          
          if (data.status === 'done') {
            clearInterval(pollIntervalRef.current);
            stopTimer();
            addLog(`Document processing complete! (Status: DONE)`, 'success');
            await fetchDocumentDetails(id);
          } else if (data.status === 'failed') {
            clearInterval(pollIntervalRef.current);
            stopTimer();
            setErrorMsg(data.error_message || 'Text extraction failed.');
            addLog(`Document processing failed: ${data.error_message}`, 'error');
          } else {
            addLog(`Polling status for ID ${id}: current status is '${data.status}'`, 'info');
          }
        } else {
          throw new Error('Failed to fetch status.');
        }
      } catch (err) {
        addLog(`Status polling warning: ${err.message}`, 'error');
      }
    }, 2000);
  };

  // Upload PDF document
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setDocStatus('uploading');
    setDocDetails(null);
    setErrorMsg(null);
    addLog(`Uploading ${selectedFile.name}...`, 'info');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('/api/documents/upload/', {
        method: 'POST',
        body: formData,
      });

      if (response.status === 201) {
        const data = await response.json();
        setUploading(false);
        setDocStatus(data.status);
        addLog(`Upload complete. Document created with ID: ${data.id}. Status: ${data.status}`, 'success');
        startPollingStatus(data.id);
      } else {
        const errData = await response.json();
        throw new Error(errData.error || `Server responded with ${response.status}`);
      }
    } catch (err) {
      setUploading(false);
      setDocStatus('failed');
      setErrorMsg(err.message);
      addLog(`Upload failed: ${err.message}`, 'error');
    }
  };

  // Copy extracted text
  const copyToClipboard = () => {
    if (docDetails && docDetails.extracted_text) {
      navigator.clipboard.writeText(docDetails.extracted_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      addLog('Extracted text copied to clipboard.', 'success');
    }
  };

  // Clean up timers on unmount
  useEffect(() => {
    checkBackendHealth();
    addLog('DocSense AI Control Center Initialized.', 'info');
    
    return () => {
      clearInterval(timerRef.current);
      clearInterval(pollIntervalRef.current);
    };
  }, []);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1 className="brand-title">DocSense AI</h1>
        <p className="brand-subtitle">RAG Pipeline verification dashboard • Document Upload & Extraction</p>
      </header>

      {/* Grid Dashboard */}
      <main className="dashboard-grid">
        {/* Backend Card */}
        <section className={`status-card ${backendStatus === 'ok' ? 'connected' : backendStatus === 'error' ? 'disconnected' : ''}`}>
          <div className="card-header">
            <div className="card-title-group">
              <Server className="card-icon" />
              <h2 className="card-title">Django API Health</h2>
            </div>
            <div className={`status-badge ${backendStatus}`}>
              <div className={`status-indicator ${backendStatus}`} />
              {backendStatus}
            </div>
          </div>
          <div className="card-body">
            <p className="card-description">
              Checks backend API status at <code>/api/health/</code>.
            </p>
            <div className="details-list">
              <div className="detail-row">
                <span className="detail-label">Endpoint</span>
                <span className="detail-value">/api/health/</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Response</span>
                <span className="detail-value">
                  {backendData ? JSON.stringify(backendData) : 'Waiting...'}
                </span>
              </div>
            </div>
          </div>
          <button 
            className="btn-action" 
            onClick={checkBackendHealth} 
            disabled={backendStatus === 'loading'}
          >
            {backendStatus === 'loading' ? (
              <RefreshCw className="spinner" />
            ) : (
              <RefreshCw size={16} />
            )}
            Refresh Status
          </button>
        </section>

        {/* Celery Card */}
        <section className="status-card celery-ready">
          <div className="card-header">
            <div className="card-title-group">
              <Cpu className="card-icon" />
              <h2 className="card-title">Celery Queue</h2>
            </div>
            <div className={`status-badge ${celeryStatus === 'error' ? 'error' : celeryStatus === 'triggered' ? 'ok' : 'warning'}`}>
              <div className={`status-indicator ${celeryStatus === 'error' ? 'error' : celeryStatus === 'triggered' ? 'ok' : 'warning'}`} />
              {celeryStatus === 'triggering' ? 'pending' : celeryStatus}
            </div>
          </div>
          <div className="card-body">
            <p className="card-description">
              Verify async worker picking up dummy tasks.
            </p>
            <div className="details-list">
              <div className="detail-row">
                <span className="detail-label">Active Queue</span>
                <span className="detail-value">Redis Broker</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Latest Task ID</span>
                <span className="detail-value">
                  {celeryTasks.length > 0 ? celeryTasks[0].task_id : 'None triggered'}
                </span>
              </div>
            </div>
          </div>
          <button 
            className="btn-action" 
            onClick={triggerCeleryTask} 
            disabled={celeryStatus === 'triggering'}
          >
            {celeryStatus === 'triggering' ? (
              <RefreshCw className="spinner" />
            ) : (
              <Play size={16} />
            )}
            Trigger Ping Task (2s)
          </button>
        </section>

        {/* Document upload card */}
        <section className="status-card console-card">
          <div className="card-header">
            <div className="card-title-group">
              <Upload className="card-icon" />
              <h2 className="card-title">Document upload & text extraction</h2>
            </div>
            {docStatus !== 'idle' && (
              <div className={`status-badge ${docStatus === 'done' ? 'ok' : docStatus === 'failed' ? 'error' : 'warning'}`}>
                <div className={`status-indicator ${docStatus === 'done' ? 'ok' : docStatus === 'failed' ? 'error' : 'warning'}`} />
                {docStatus} {docStatus !== 'done' && docStatus !== 'failed' && `(${elapsedSeconds}s)`}
              </div>
            )}
          </div>
          
          <div className="card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '2rem' }}>
            {/* Upload form Column */}
            <div>
              <form onSubmit={handleUploadSubmit} className="upload-form">
                <p className="card-description" style={{ marginBottom: '1rem' }}>
                  Upload a PDF document. It will be stored and text will be extracted asynchronously.
                </p>
                
                <div 
                  className="upload-dropzone" 
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed rgba(99, 102, 241, 0.3)',
                    borderRadius: '12px',
                    padding: '2.5rem 1rem',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.01)',
                    marginBottom: '1rem',
                    transition: 'border 0.2s',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-accent)'}
                  onMouseOut={(e) => e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.3)'}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    style={{ display: 'none' }}
                    accept=".pdf"
                  />
                  <FileText size={40} className="card-icon" style={{ marginBottom: '0.75rem', opacity: 0.7 }} />
                  <p style={{ fontWeight: '500', marginBottom: '0.25rem' }}>
                    {selectedFile ? selectedFile.name : 'Select PDF File'}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'Click to browse files'}
                  </p>
                </div>

                {errorMsg && (
                  <div className="console-error" style={{ marginBottom: '1rem', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertCircle size={16} /> {errorMsg}
                  </div>
                )}

                <button 
                  type="submit" 
                  className="btn-action" 
                  disabled={!selectedFile || uploading || docStatus === 'pending' || docStatus === 'processing'}
                >
                  {uploading || docStatus === 'pending' || docStatus === 'processing' ? (
                    <>
                      <RefreshCw className="spinner" />
                      {docStatus === 'uploading' ? 'Uploading...' : 'Extracting Text...'}
                    </>
                  ) : (
                    <>
                      <Upload size={16} />
                      Upload & Extract
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Extracted text Column */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '300px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h3 className="card-title" style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Terminal size={16} /> Extracted Raw Text
                </h3>
                {docDetails && docDetails.extracted_text && (
                  <button 
                    onClick={copyToClipboard}
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      border: 'none',
                      color: 'var(--text-primary)',
                      padding: '0.4rem 0.8rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      fontSize: '0.8rem',
                      transition: 'background 0.2s',
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
                    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  >
                    {copied ? <Check size={14} className="console-success" /> : <Copy size={14} />}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                )}
              </div>
              <div 
                className="console-container" 
                style={{ 
                  flexGrow: 1, 
                  height: '100%', 
                  maxHeight: 'none', 
                  minHeight: '220px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: docDetails ? 'flex-start' : 'center',
                  alignItems: docDetails ? 'stretch' : 'center',
                  color: docDetails ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: '0.9rem',
                }}
              >
                {docDetails ? (
                  <pre style={{ 
                    whiteSpace: 'pre-wrap', 
                    wordBreak: 'break-all', 
                    fontFamily: 'monospace', 
                    textAlign: 'left',
                    margin: 0,
                    lineHeight: 1.5,
                  }}>
                    {docDetails.extracted_text || 'No text content extracted.'}
                  </pre>
                ) : (
                  <div style={{ textAlign: 'center', padding: '1rem' }}>
                    {docStatus === 'pending' || docStatus === 'processing' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                        <RefreshCw className="spinner" size={24} style={{ color: 'var(--color-accent)' }} />
                        <p style={{ color: 'var(--text-secondary)' }}>Extracting text from PDF...</p>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Elapsed time: {elapsedSeconds} seconds</p>
                      </div>
                    ) : docStatus === 'failed' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', color: 'var(--color-danger)' }}>
                        <XCircle size={32} />
                        <p>Extraction Failed</p>
                      </div>
                    ) : (
                      <div style={{ opacity: 0.5 }}>
                        <FileText size={32} style={{ margin: '0 auto 0.5rem' }} />
                        <p>No document loaded yet.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Console logs card */}
        <section className="status-card console-card">
          <div className="card-header">
            <div className="card-title-group">
              <Terminal className="card-icon" />
              <h2 className="card-title">System Console Logs</h2>
            </div>
          </div>
          <div className="console-container" style={{ maxHeight: '180px' }}>
            {logs.length === 0 ? (
              <div className="console-line">Console idle...</div>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="console-line">
                  <span className="console-timestamp">[{log.time}]</span>
                  <span className={`console-${log.type}`}>{log.text}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer">
        <p>DocSense AI • Docker Compose Scaffold • pgvector Enabled</p>
      </footer>
    </div>
  );
}

export default App;
