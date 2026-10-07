import React, { useState, useEffect, useRef } from 'react';
import { 
  Server, 
  Cpu, 
  Terminal, 
  Play, 
  RefreshCw, 
  Upload, 
  FileText, 
  AlertCircle,
  Copy,
  Check,
  Send,
  Sparkles,
  Key,
  Trash2,
  Layers,
  MessageSquare,
  FileCode,
  ExternalLink,
  BookOpen,
  Plus,
  History
} from 'lucide-react';
import './App.css';

function App() {
  // Config & API Key
  const [config, setConfig] = useState(null);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('docsense_gemini_key') || '');
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [tempKey, setTempKey] = useState(apiKey);

  // System Health
  const [backendStatus, setBackendStatus] = useState('loading');
  const [celeryStatus, setCeleryStatus] = useState('idle');
  const [logs, setLogs] = useState([]);

  // Documents
  const [documents, setDocuments] = useState([]);
  const [activeDocId, setActiveDocId] = useState(null);
  const [activeDoc, setActiveDoc] = useState(null);
  const [activeChunks, setActiveChunks] = useState([]);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'text' | 'diagnostics'
  const [textSubTab, setTextSubTab] = useState('chunks'); // 'chunks' | 'raw'

  // Chat Sessions & Memory
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputQuestion, setInputQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [copied, setCopied] = useState(false);
  const chatBottomRef = useRef(null);

  // Upload
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // Add system log
  const addLog = (text, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [{ time: timestamp, text, type }, ...prev.slice(0, 49)]);
  };

  // Check Backend Health & Config
  const fetchStatusAndConfig = async () => {
    try {
      const [healthRes, configRes] = await Promise.all([
        fetch('/api/health/'),
        fetch('/api/config/status/')
      ]);

      if (healthRes.ok) {
        setBackendStatus('ok');
      } else {
        setBackendStatus('error');
      }

      if (configRes.ok) {
        const conf = await configRes.json();
        setConfig(conf);
      }
    } catch (err) {
      setBackendStatus('error');
      addLog(`Failed to connect to backend: ${err.message}`, 'error');
    }
  };

  // Fetch Documents List
  const fetchDocuments = async () => {
    try {
      const res = await fetch('/api/documents/');
      if (res.ok) {
        const list = await res.json();
        setDocuments(list);
        if (list.length > 0 && !activeDocId) {
          selectDocument(list[0].id);
        }
      }
    } catch (err) {
      addLog(`Failed to fetch documents: ${err.message}`, 'error');
    }
  };

  // Fetch Sessions for a Document
  const loadSessionsForDoc = async (docId) => {
    try {
      const res = await fetch(`/api/documents/${docId}/sessions/`);
      if (res.ok) {
        const sessList = await res.json();
        setSessions(sessList);
        if (sessList.length > 0) {
          loadSessionDetails(sessList[0].id);
        } else {
          // Auto-create initial session
          createNewSession(docId);
        }
      }
    } catch (err) {
      addLog(`Failed to load sessions: ${err.message}`, 'error');
    }
  };

  // Load a single session and its messages
  const loadSessionDetails = async (sessionId) => {
    setActiveSessionId(sessionId);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/`);
      if (res.ok) {
        const data = await res.json();
        setActiveSession(data);
        setMessages(data.messages || []);
      }
    } catch (err) {
      addLog(`Failed to load session #${sessionId}: ${err.message}`, 'error');
    }
  };

  // Create a New Chat Session
  const createNewSession = async (docId = activeDocId) => {
    if (!docId) return;
    try {
      const res = await fetch(`/api/documents/${docId}/sessions/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New Conversation' })
      });
      if (res.ok) {
        const newSess = await res.json();
        setSessions(prev => [newSess, ...prev]);
        setActiveSessionId(newSess.id);
        setActiveSession(newSess);
        setMessages([]);
        addLog(`Started new conversation thread #${newSess.id}`, 'info');
      }
    } catch (err) {
      addLog(`Failed to create new session: ${err.message}`, 'error');
    }
  };

  // Delete a Chat Session
  const deleteSession = async (e, sessionId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this chat thread and its history?')) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/`, { method: 'DELETE' });
      if (res.ok) {
        addLog(`Deleted session #${sessionId}`, 'info');
        const remaining = sessions.filter(s => s.id !== sessionId);
        setSessions(remaining);
        if (remaining.length > 0) {
          loadSessionDetails(remaining[0].id);
        } else {
          createNewSession(activeDocId);
        }
      }
    } catch (err) {
      addLog(`Failed to delete session: ${err.message}`, 'error');
    }
  };

  // Select Active Document
  const selectDocument = async (id) => {
    setActiveDocId(id);
    try {
      const [docRes, chunksRes] = await Promise.all([
        fetch(`/api/documents/${id}/`),
        fetch(`/api/documents/${id}/chunks/`)
      ]);
      if (docRes.ok) {
        const doc = await docRes.json();
        setActiveDoc(doc);
      }
      if (chunksRes.ok) {
        const chunks = await chunksRes.json();
        setActiveChunks(chunks);
      }
      // Load sessions with memory
      loadSessionsForDoc(id);
    } catch (err) {
      addLog(`Failed to load document #${id}: ${err.message}`, 'error');
    }
  };

  // Poll status for a processing document
  const pollDocumentStatus = (id) => {
    clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/documents/${id}/status/`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === 'done') {
            clearInterval(pollIntervalRef.current);
            addLog(`Document #${id} processing completed!`, 'success');
            fetchDocuments();
            if (activeDocId === id) selectDocument(id);
          } else if (data.status === 'failed') {
            clearInterval(pollIntervalRef.current);
            addLog(`Document #${id} processing failed: ${data.error_message}`, 'error');
            fetchDocuments();
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 2000);
  };

  // Delete Document
  const deleteDocument = async (e, id) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    try {
      const res = await fetch(`/api/documents/${id}/`, { method: 'DELETE' });
      if (res.ok) {
        addLog(`Document #${id} deleted`, 'info');
        setDocuments(prev => prev.filter(d => d.id !== id));
        if (activeDocId === id) {
          setActiveDocId(null);
          setActiveDoc(null);
          setActiveChunks([]);
          setSessions([]);
          setMessages([]);
        }
      }
    } catch (err) {
      addLog(`Delete failed: ${err.message}`, 'error');
    }
  };

  // File selection
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are supported.');
      return;
    }
    setUploadError(null);
    setSelectedFile(file);
  };

  // Upload Document
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;

    setUploading(true);
    setUploadError(null);
    addLog(`Uploading '${selectedFile.name}'...`, 'info');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const res = await fetch('/api/documents/upload/', {
        method: 'POST',
        body: formData
      });
      if (res.status === 201) {
        const data = await res.json();
        setUploading(false);
        setSelectedFile(null);
        addLog(`Upload success! Document created with ID #${data.id}`, 'success');
        await fetchDocuments();
        selectDocument(data.id);
        pollDocumentStatus(data.id);
      } else {
        const errData = await res.json();
        throw new Error(errData.error || `Error ${res.status}`);
      }
    } catch (err) {
      setUploading(false);
      setUploadError(err.message);
      addLog(`Upload error: ${err.message}`, 'error');
    }
  };

  // Trigger Celery Ping Task
  const triggerCeleryTask = async () => {
    setCeleryStatus('triggering');
    addLog('Dispatching Celery ping test task...', 'info');
    try {
      const res = await fetch('/api/health/celery/');
      if (res.ok) {
        const data = await res.json();
        setCeleryStatus('triggered');
        addLog(`Celery task dispatched. Task ID: ${data.task_id}`, 'success');
      }
    } catch (err) {
      setCeleryStatus('error');
      addLog(`Celery dispatch error: ${err.message}`, 'error');
    }
  };

  // Send Chat Question with Conversation Memory
  const handleSendQuestion = async (promptText) => {
    const query = (promptText || inputQuestion).trim();
    if (!query || !activeSessionId || asking) return;

    setInputQuestion('');
    setAsking(true);

    const tempUserMsg = {
      id: Date.now(),
      role: 'user',
      content: query,
      created_at: new Date().toISOString()
    };

    setMessages(prev => [...prev, tempUserMsg]);
    addLog(`[Memory Thread #${activeSessionId}] Sent: "${query}"`, 'info');

    try {
      const payload = { question: query };
      if (apiKey) payload.api_key = apiKey;

      const res = await fetch(`/api/sessions/${activeSessionId}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (res.ok) {
        const aiMsg = {
          id: data.assistant_message_id,
          role: 'assistant',
          content: data.answer,
          sources: data.sources || [],
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, aiMsg]);

        // Update session title in session list if changed
        if (data.session_title) {
          setSessions(prev => prev.map(s => 
            s.id === activeSessionId ? { ...s, title: data.session_title } : s
          ));
        }

        addLog(`AI answered with ${data.sources?.length || 0} citations (Contextualized: "${data.search_query || query}")`, 'success');
      } else {
        if (data.needs_api_key) {
          setShowKeyModal(true);
        }
        const errorMsg = {
          id: Date.now() + 1,
          role: 'assistant',
          content: `⚠️ Error: ${data.error || 'Failed to generate answer.'}`,
          sources: [],
          created_at: new Date().toISOString()
        };
        setMessages(prev => [...prev, errorMsg]);
        addLog(`Chat error: ${data.error}`, 'error');
      }
    } catch (err) {
      const errorMsg = {
        id: Date.now() + 1,
        role: 'assistant',
        content: `⚠️ Network error: ${err.message}`,
        sources: [],
        created_at: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setAsking(false);
    }
  };

  // Save API Key
  const handleSaveApiKey = () => {
    localStorage.setItem('docsense_gemini_key', tempKey.trim());
    setApiKey(tempKey.trim());
    setShowKeyModal(false);
    addLog(tempKey ? 'Gemini API key saved to browser session.' : 'API key cleared.', 'info');
  };

  // Copy raw text
  const copyText = () => {
    if (activeDoc?.extracted_text) {
      navigator.clipboard.writeText(activeDoc.extracted_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  useEffect(() => {
    fetchStatusAndConfig();
    fetchDocuments();
    addLog('DocSense AI Document Control Initialized with Multi-turn Memory.', 'info');
    return () => clearInterval(pollIntervalRef.current);
  }, []);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, asking]);

  return (
    <div className="docsense-root">
      {/* Top Navbar */}
      <header className="docsense-navbar">
        <div className="nav-brand">
          <div className="brand-badge-icon">
            <Sparkles size={22} className="sparkle-icon" />
          </div>
          <div>
            <h1 className="nav-title">DocSense AI</h1>
            <p className="nav-subtitle">Retrieval-Augmented Generation Document Intelligence • Multi-turn Memory</p>
          </div>
        </div>

        <div className="nav-status-group">
          {/* Backend Status */}
          <div className={`nav-pill ${backendStatus === 'ok' ? 'pill-success' : 'pill-danger'}`} title="Backend DRF API">
            <span className={`status-dot ${backendStatus === 'ok' ? 'dot-pulse-green' : ''}`} />
            <span>{backendStatus === 'ok' ? 'API Online' : 'API Offline'}</span>
          </div>

          {/* Model Status */}
          <div className="nav-pill pill-ai">
            <Cpu size={14} />
            <span>Gemini 1.5 + pgvector</span>
          </div>

          {/* API Key Settings Button */}
          <button 
            id="btn-settings-key"
            className={`btn-key-settings ${apiKey || config?.gemini_configured ? 'has-key' : 'needs-key'}`}
            onClick={() => setShowKeyModal(true)}
          >
            <Key size={14} />
            <span>{apiKey || config?.gemini_configured ? 'API Key Set' : 'Set Gemini Key'}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="workspace-container">
        {/* Left Sidebar: Document Library & Upload */}
        <aside className="workspace-sidebar">
          {/* Upload Card */}
          <div className="sidebar-section upload-box">
            <h2 className="section-title">
              <Upload size={16} /> Upload PDF
            </h2>
            <form onSubmit={handleUploadSubmit}>
              <div 
                className="dropzone"
                onClick={() => fileInputRef.current?.click()}
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept=".pdf" 
                  style={{ display: 'none' }}
                />
                <FileText size={28} className="dropzone-icon" />
                <p className="dropzone-label">
                  {selectedFile ? selectedFile.name : 'Choose or drop a PDF'}
                </p>
                <span className="dropzone-hint">
                  {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'Vectorized with pgvector'}
                </span>
              </div>

              {uploadError && (
                <div className="error-banner">
                  <AlertCircle size={14} /> {uploadError}
                </div>
              )}

              <button 
                id="btn-upload-pdf"
                type="submit" 
                className="btn-upload" 
                disabled={!selectedFile || uploading}
              >
                {uploading ? (
                  <>
                    <RefreshCw size={14} className="spinner" />
                    Ingesting & Chunking...
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    Process Document
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Documents List */}
          <div className="sidebar-section documents-list-section">
            <div className="section-header-flex">
              <h2 className="section-title">
                <BookOpen size={16} /> Document Library ({documents.length})
              </h2>
              <button className="btn-icon-refresh" onClick={fetchDocuments} title="Refresh documents">
                <RefreshCw size={13} />
              </button>
            </div>

            <div className="documents-scroll">
              {documents.length === 0 ? (
                <div className="empty-state-sidebar">
                  No documents uploaded yet. Upload a PDF above to begin.
                </div>
              ) : (
                documents.map(doc => (
                  <div 
                    key={doc.id}
                    id={`doc-item-${doc.id}`}
                    className={`document-card ${activeDocId === doc.id ? 'active' : ''}`}
                    onClick={() => selectDocument(doc.id)}
                  >
                    <div className="doc-icon-wrap">
                      <FileText size={18} />
                    </div>
                    <div className="doc-meta">
                      <p className="doc-filename" title={doc.original_filename}>
                        {doc.original_filename}
                      </p>
                      <div className="doc-badges">
                        <span className={`status-tag status-${doc.status}`}>
                          {doc.status}
                        </span>
                        <span className="chunk-tag">
                          {doc.chunks_count || 0} chunks
                        </span>
                      </div>
                    </div>
                    <button 
                      className="btn-delete-doc"
                      onClick={(e) => deleteDocument(e, doc.id)}
                      title="Delete document"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Right Main Stage */}
        <main className="workspace-main">
          {activeDoc ? (
            <div className="main-active-panel">
              {/* Document Banner & Tabs */}
              <div className="doc-header-banner">
                <div className="doc-banner-info">
                  <div className="active-file-indicator">
                    <FileText size={18} className="file-icon" />
                    <div>
                      <h2 className="active-doc-name">{activeDoc.original_filename}</h2>
                      <p className="active-doc-sub">
                        Status: <strong style={{ color: activeDoc.status === 'done' ? 'var(--color-success)' : 'var(--color-warning)' }}>{activeDoc.status}</strong> • {activeChunks.length} Vector Chunks • {sessions.length} Chat Threads
                      </p>
                    </div>
                  </div>
                </div>

                <div className="tab-nav">
                  <button 
                    id="tab-btn-chat"
                    className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
                    onClick={() => setActiveTab('chat')}
                  >
                    <MessageSquare size={15} /> Chat & Memory
                  </button>
                  <button 
                    id="tab-btn-text"
                    className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`}
                    onClick={() => setActiveTab('text')}
                  >
                    <Layers size={15} /> Chunks & Text ({activeChunks.length})
                  </button>
                  <button 
                    id="tab-btn-diagnostics"
                    className={`tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
                    onClick={() => setActiveTab('diagnostics')}
                  >
                    <Terminal size={15} /> Diagnostics
                  </button>
                </div>
              </div>

              {/* Tab 1: AI Chat Interface with Multi-turn Memory */}
              {activeTab === 'chat' && (
                <div className="chat-container">
                  {/* Threads / Session Bar */}
                  <div className="session-bar">
                    <div className="session-bar-left">
                      <History size={14} className="session-icon" />
                      <span className="session-bar-label">Threads:</span>
                      <div className="session-chips-scroll">
                        {sessions.map(s => (
                          <div 
                            key={s.id}
                            className={`session-chip ${activeSessionId === s.id ? 'active' : ''}`}
                            onClick={() => loadSessionDetails(s.id)}
                            title={s.title}
                          >
                            <span className="session-chip-title">{s.title}</span>
                            <button 
                              className="btn-delete-session"
                              onClick={(e) => deleteSession(e, s.id)}
                              title="Delete thread"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                    <button 
                      id="btn-new-chat"
                      className="btn-new-thread"
                      onClick={() => createNewSession()}
                      title="Start fresh conversation thread"
                    >
                      <Plus size={14} /> New Thread
                    </button>
                  </div>

                  {/* Messages Area */}
                  {messages.length === 0 ? (
                    <div className="chat-empty-state">
                      <div className="chat-empty-icon">
                        <Sparkles size={36} />
                      </div>
                      <h3>Start a Conversation with Memory</h3>
                      <p>
                        Ask questions and follow up naturally! DocSense AI automatically contextualizes pronouns and keeps track of the conversation history.
                      </p>
                      <div className="prompt-suggestions">
                        <button 
                          className="suggestion-chip"
                          onClick={() => handleSendQuestion("Summarize the key takeaways of this document.")}
                        >
                          Summarize key takeaways
                        </button>
                        <button 
                          className="suggestion-chip"
                          onClick={() => handleSendQuestion("What are the main topics and conclusions?")}
                        >
                          Main topics & conclusions
                        </button>
                        <button 
                          className="suggestion-chip"
                          onClick={() => handleSendQuestion("Extract any important dates, numbers, or action items.")}
                        >
                          Important dates & numbers
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="chat-messages-area">
                      {messages.map((msg, i) => (
                        <div key={msg.id || i} className={`chat-bubble-wrap ${msg.role === 'user' ? 'user' : 'ai'}`}>
                          <div className="chat-sender-label">
                            {msg.role === 'user' ? 'You' : 'DocSense AI (Gemini + Memory)'} • {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                          <div className={`chat-bubble ${msg.role === 'user' ? 'user' : 'ai'}`}>
                            <div className="chat-text-content" style={{ whiteSpace: 'pre-wrap' }}>
                              {msg.content}
                            </div>

                            {/* Source Citations */}
                            {msg.sources && msg.sources.length > 0 && (
                              <div className="sources-container">
                                <div className="sources-header">
                                  <Layers size={13} />
                                  <span>Retrieved Sources from Document:</span>
                                </div>
                                <div className="sources-list">
                                  {msg.sources.map((src, sIdx) => (
                                    <div key={sIdx} className="source-card">
                                      <div className="source-card-header">
                                        <span className="page-pill">
                                          Page {src.page_number || '1'}
                                        </span>
                                        <span className="similarity-pill">
                                          Chunk #{src.chunk_index}
                                        </span>
                                      </div>
                                      <p className="source-snippet">{src.snippet}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {asking && (
                        <div className="chat-bubble-wrap ai">
                          <div className="chat-sender-label">DocSense AI is reasoning...</div>
                          <div className="chat-bubble ai thinking">
                            <RefreshCw size={16} className="spinner" />
                            <span>Contextualizing with conversation memory & generating response...</span>
                          </div>
                        </div>
                      )}
                      <div ref={chatBottomRef} />
                    </div>
                  )}

                  {/* Chat Input Bar */}
                  <div className="chat-input-bar">
                    <input 
                      id="input-chat-query"
                      type="text"
                      className="chat-input"
                      placeholder={`Ask or follow up on ${activeDoc.original_filename}...`}
                      value={inputQuestion}
                      onChange={(e) => setInputQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSendQuestion()}
                      disabled={asking || activeDoc.status !== 'done'}
                    />
                    <button 
                      id="btn-chat-send"
                      className="btn-send-chat"
                      onClick={() => handleSendQuestion()}
                      disabled={!inputQuestion.trim() || asking || activeDoc.status !== 'done'}
                    >
                      {asking ? <RefreshCw size={16} className="spinner" /> : <Send size={16} />}
                      <span>Send</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 2: Chunks & Raw Text */}
              {activeTab === 'text' && (
                <div className="text-viewer-tab">
                  <div className="sub-tab-bar">
                    <button 
                      className={`sub-tab-btn ${textSubTab === 'chunks' ? 'active' : ''}`}
                      onClick={() => setTextSubTab('chunks')}
                    >
                      <Layers size={14} /> Semantic Chunks ({activeChunks.length})
                    </button>
                    <button 
                      className={`sub-tab-btn ${textSubTab === 'raw' ? 'active' : ''}`}
                      onClick={() => setTextSubTab('raw')}
                    >
                      <FileCode size={14} /> Raw Extracted Text
                    </button>
                    {textSubTab === 'raw' && (
                      <button className="btn-copy-raw" onClick={copyText}>
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                        {copied ? 'Copied!' : 'Copy All'}
                      </button>
                    )}
                  </div>

                  {textSubTab === 'chunks' ? (
                    <div className="chunks-grid">
                      {activeChunks.length === 0 ? (
                        <div className="empty-chunks">No chunks generated for this document yet.</div>
                      ) : (
                        activeChunks.map(chunk => (
                          <div key={chunk.id} className="chunk-card">
                            <div className="chunk-header">
                              <span className="chunk-index-tag">Chunk #{chunk.chunk_index}</span>
                              <span className="chunk-page-tag">Page {chunk.page_number || 'N/A'}</span>
                              <span className={`vector-status ${chunk.has_embedding ? 'embedded' : 'placeholder'}`}>
                                {chunk.has_embedding ? 'Vector 768-dim' : 'Vector Ready'}
                              </span>
                            </div>
                            <p className="chunk-body">{chunk.content}</p>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="raw-text-container">
                      <pre className="raw-pre">
                        {activeDoc.extracted_text || 'No text extracted.'}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Diagnostics */}
              {activeTab === 'diagnostics' && (
                <div className="diagnostics-tab">
                  <div className="diag-cards-row">
                    <div className="diag-card">
                      <div className="diag-card-title">
                        <Server size={16} /> Backend DRF Engine
                      </div>
                      <p className="diag-desc">Status: <strong>{backendStatus}</strong></p>
                      <button className="btn-action-sm" onClick={fetchStatusAndConfig}>
                        <RefreshCw size={13} /> Check Health
                      </button>
                    </div>

                    <div className="diag-card">
                      <div className="diag-card-title">
                        <Cpu size={16} /> Celery & Redis Task Queue
                      </div>
                      <p className="diag-desc">Worker status: <strong>{celeryStatus}</strong></p>
                      <button className="btn-action-sm" onClick={triggerCeleryTask}>
                        <Play size={13} /> Trigger Ping Task (2s)
                      </button>
                    </div>
                  </div>

                  <div className="diag-console-box">
                    <div className="diag-console-title">
                      <Terminal size={14} /> Live System Logs
                    </div>
                    <div className="console-lines">
                      {logs.map((log, i) => (
                        <div key={i} className="log-line">
                          <span className="log-time">[{log.time}]</span>
                          <span className={`log-text log-${log.type}`}>{log.text}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="no-doc-selected">
              <BookOpen size={48} className="empty-icon-main" />
              <h2>Select or Upload a Document</h2>
              <p>Choose an existing document from the left library or upload a new PDF to inspect chunks and chat.</p>
            </div>
          )}
        </main>
      </div>

      {/* API Key Modal */}
      {showKeyModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div className="modal-header">
              <div className="modal-title-wrap">
                <Key size={18} className="modal-key-icon" />
                <h3>Google Gemini API Key</h3>
              </div>
              <button className="btn-close-modal" onClick={() => setShowKeyModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                DocSense AI uses Google Gemini (<code>text-embedding-004</code> for 768-dim vector embeddings and <code>gemini-1.5-flash</code> for RAG document answering).
              </p>
              <div className="input-group">
                <label>Gemini API Key:</label>
                <input 
                  type="password"
                  className="modal-input"
                  placeholder="AIzaSy..."
                  value={tempKey}
                  onChange={(e) => setTempKey(e.target.value)}
                />
              </div>
              <a 
                href="https://aistudio.google.com/app/apikey" 
                target="_blank" 
                rel="noreferrer" 
                className="get-key-link"
              >
                Get a free API key at Google AI Studio <ExternalLink size={12} />
              </a>
            </div>
            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowKeyModal(false)}>Cancel</button>
              <button className="btn-save-key" onClick={handleSaveApiKey}>Save Key</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
