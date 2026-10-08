"use client";

import { FormEvent, useEffect, useState } from "react";

type Repo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  default_branch: string;
  description: string | null;
};

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function Manager() {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hello! I am your GitHub AI Manager. You can ask me to manage repositories, files, branches, commits and pull requests."
    }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadRepos() {
    try {
      const response = await fetch("/api/github/repos");

      if (!response.ok) {
        throw new Error("Failed to load repositories");
      }

      const data = await response.json();
      setRepos(data.repositories || []);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    loadRepos();
  }, []);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();

    const text = input.trim();

    if (!text || loading) return;

    const userMessage: Message = {
      role: "user",
      content: text
    };

    const nextMessages = [...messages, userMessage];

    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: nextMessages,
          selectedRepo
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong");
      }

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: data.message || "Done."
        }
      ]);

      if (data.refreshRepos) {
        await loadRepos();
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? `Error: ${error.message}`
              : "Something went wrong."
        }
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">GH</div>

          <div>
            <h1>GitHub AI</h1>
            <p>Manager</p>
          </div>
        </div>

        <div className="sidebar-section">
          <div className="section-title">
            <span>Repositories</span>
            <button onClick={loadRepos} title="Refresh">
              ↻
            </button>
          </div>

          <div className="repo-list">
            {repos.length === 0 ? (
              <div className="empty-repos">
                No repositories found.
              </div>
            ) : (
              repos.map((repo) => (
                <button
                  key={repo.id}
                  className={`repo-item ${
                    selectedRepo === repo.full_name ? "active" : ""
                  }`}
                  onClick={() => setSelectedRepo(repo.full_name)}
                >
                  <span className="repo-dot" />

                  <span className="repo-info">
                    <strong>{repo.name}</strong>
                    <small>
                      {repo.private ? "Private" : "Public"}
                    </small>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>GitHub AI Manager</h2>
            <p>
              {selectedRepo
                ? `Selected: ${selectedRepo}`
                : "Manage your GitHub with natural language"}
            </p>
          </div>

          <div className="status">
            <span className="status-dot" />
            Connected
          </div>
        </header>

        <section className="chat-area">
          <div className="messages">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`message-row ${message.role}`}
              >
                <div className="message-avatar">
                  {message.role === "user" ? "U" : "AI"}
                </div>

                <div className="message-bubble">
                  {message.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="message-row assistant">
                <div className="message-avatar">AI</div>

                <div className="message-bubble typing">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
          </div>
        </section>

        <form className="composer" onSubmit={sendMessage}>
          <div className="input-wrap">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask me to manage your GitHub..."
              rows={1}
              disabled={loading}
            />

            <button
              type="submit"
              disabled={loading || !input.trim()}
            >
              {loading ? "..." : "Send"}
            </button>
          </div>

          <div className="composer-hint">
            Example: "Create a repository named mobile-bot"
          </div>
        </form>
      </section>
    </main>
  );
    }
