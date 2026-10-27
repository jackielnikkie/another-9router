"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { summarizeResults, speedTier, formatLatency, probeModel, mapWithConcurrency, PROBE_CONCURRENCY } from "@/shared/utils/modelSpeed";

// Parallel probes are capped by PROBE_CONCURRENCY: a compatible node can hold
// dozens of models and the ping route fans out to a real upstream call per model.

const TIER_COLOR = {
  fast: "text-green-500 bg-green-500/10",
  mid: "text-yellow-500 bg-yellow-500/10",
  slow: "text-red-500 bg-red-500/10",
  unknown: "text-text-muted bg-surface-2",
};

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, result, isTesting }) {
  const testStatus = result ? (result.ok ? "ok" : "error") : null;
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
          {result && (
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${TIER_COLOR[speedTier(result.latencyMs)]}`}>
              {result.ok ? formatLatency(result.latencyMs) : "fail"}
            </span>
          )}
        </div>
        {result && !result.ok && result.error && (
          <p className="text-[10px] text-red-500 mt-1 truncate" title={result.error}>{result.error}</p>
        )}
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

CompatibleModelRow.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onTest: PropTypes.func,
  result: PropTypes.shape({
    ok: PropTypes.bool,
    latencyMs: PropTypes.number,
    error: PropTypes.string,
  }),
  isTesting: PropTypes.bool,
};

// Result card: which models answer, which don't, and how fast.
function TestResultsCard({ models, results, running }) {
  const summary = summarizeResults(results);
  const tested = models
    .map((model) => ({ id: model.id, result: results[model.id] }))
    .filter((row) => row.result)
    .sort((a, b) => {
      if (a.result.ok !== b.result.ok) return a.result.ok ? -1 : 1;
      if (a.result.ok) return (a.result.latencyMs ?? Infinity) - (b.result.latencyMs ?? Infinity);
      return a.id.localeCompare(b.id);
    });

  return (
    <div className="rounded-lg border border-border p-3 flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="font-semibold text-text-main">
          {running ? `Testing ${tested.length}/${models.length}…` : `${summary.total} tested`}
        </span>
        <span className="text-green-500">{summary.ok} ok</span>
        <span className="text-red-500">{summary.fail} fail</span>
        {summary.median != null && (
          <span className="text-text-muted">median {formatLatency(summary.median)}</span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {tested.map(({ id, result }) => (
          <div
            key={id}
            className={`flex flex-col gap-0.5 rounded-md border px-2 py-1.5 ${
              result.ok ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className="material-symbols-outlined text-sm"
                style={{ color: result.ok ? "#22c55e" : "#ef4444" }}
              >
                {result.ok ? "check_circle" : "cancel"}
              </span>
              <code className="text-[11px] font-mono truncate flex-1" title={id}>{id}</code>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${TIER_COLOR[speedTier(result.latencyMs)]}`}>
                {result.ok ? formatLatency(result.latencyMs) : "fail"}
              </span>
            </div>
            {!result.ok && result.error && (
              <p className="text-[10px] text-red-500 break-words line-clamp-2" title={result.error}>{result.error}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

TestResultsCard.propTypes = {
  models: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string.isRequired })).isRequired,
  results: PropTypes.object.isRequired,
  running: PropTypes.bool,
};

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [testAllRunning, setTestAllRunning] = useState(false);
  const [results, setResults] = useState({});

  const runTest = (modelId) => probeModel(`${providerStorageAlias}/${modelId}`, "llm");

  const handleTestModel = async (modelId) => {
    if (testingModelId || testAllRunning) return;
    setTestingModelId(modelId);
    try {
      const result = await runTest(modelId);
      setResults((prev) => ({ ...prev, [modelId]: result }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleTestAll = async () => {
    if (testAllRunning || allModels.length === 0) return;
    setTestAllRunning(true);
    setResults({});
    const ids = allModels.map((model) => model.id);
    try {
      await mapWithConcurrency(ids, PROBE_CONCURRENCY, async (id) => {
        const result = await runTest(id);
        setResults((prev) => ({ ...prev, [id]: result }));
      });
    } finally {
      setTestAllRunning(false);
    }
  };

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);
  const canTest = connections.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="science"
          onClick={handleTestAll}
          disabled={!canTest || testAllRunning || allModels.length === 0}
        >
          {testAllRunning ? "Testing..." : "Test All"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {Object.keys(results).length > 0 && (
        <TestResultsCard models={allModels} results={results} running={testAllRunning} />
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={canTest ? () => handleTestModel(id) : undefined}
              result={results[id]}
              isTesting={testingModelId === id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
