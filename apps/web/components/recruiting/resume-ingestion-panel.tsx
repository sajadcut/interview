"use client";

import type { components } from "@interview/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiErrorMessage } from "../../lib/api";
import { resolveTenantIdentity, tenantHeaders, type TenantIdentity } from "../../lib/tenant-client";
import { useInternalAccess } from "../product/internal-access";
import { Panel, Pill } from "../product/recruiting-ui";

type ResumeDto = components["schemas"]["ResumeDto"];

const MAX_RESUME_BYTES = 10 * 1024 * 1024;
const ACCEPTED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);
const RESUME_MANAGER_ROLES = new Set(["PLATFORM_ADMIN", "ORGANIZATION_ADMIN", "RECRUITER", "org_admin"]);

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(status: string): "green" | "amber" | "red" | "blue" {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "extracting" || status === "parsing") return "amber";
  return "blue";
}

export function ResumeIngestionPanel({
  candidateId,
  identity: providedIdentity,
  applicationId,
  onIngested,
}: {
  candidateId: string;
  identity?: TenantIdentity;
  applicationId?: string;
  onIngested?: () => void | Promise<void>;
}) {
  const access = useInternalAccess();
  const inputRef = useRef<HTMLInputElement>(null);
  const [identity, setIdentity] = useState<TenantIdentity | undefined>(providedIdentity);
  const [resumes, setResumes] = useState<ResumeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string>();
  const canManageResume = access.roles.some((role) => RESUME_MANAGER_ROLES.has(role));

  useEffect(() => {
    if (providedIdentity) {
      setIdentity(providedIdentity);
      return;
    }
    let active = true;
    void resolveTenantIdentity()
      .then((resolved) => {
        if (active) setIdentity(resolved);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "No active organization is available");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [providedIdentity]);

  const loadResumes = useCallback(async () => {
    if (!identity) return;
    const result = await api.GET("/v1/candidates/{candidateId}/resumes", {
      params: { path: { candidateId } },
      headers: tenantHeaders(identity),
    });
    if (result.error) {
      setMessage(apiErrorMessage(result, "Resume history could not be loaded"));
      setLoading(false);
      return;
    }
    setResumes(result.data ?? []);
    setLoading(false);
  }, [candidateId, identity]);

  useEffect(() => {
    void loadResumes();
  }, [loadResumes]);

  async function uploadResume(file: File) {
    if (!identity || !canManageResume) return;
    if (file.size <= 0 || file.size > MAX_RESUME_BYTES) {
      setMessage("Resume must be between 1 byte and 10 MB.");
      return;
    }
    if (!ACCEPTED_RESUME_TYPES.has(file.type)) {
      setMessage("Supported resume formats are PDF, DOCX and UTF-8 plain text.");
      return;
    }

    setUploading(true);
    setMessage(undefined);
    try {
      const result = await api.POST("/v1/candidates/{candidateId}/resumes", {
        params: { path: { candidateId } },
        headers: tenantHeaders(identity),
        body: {
          file: file.name,
          ...(applicationId ? { applicationId } : {}),
        },
        bodySerializer: () => {
          const form = new FormData();
          form.append("file", file, file.name);
          if (applicationId) form.append("applicationId", applicationId);
          return form;
        },
      });
      if (result.error || !result.data) {
        setMessage(apiErrorMessage(result, "Resume ingestion failed"));
        return;
      }
      const ingested = result.data;
      setMessage(
        ingested.status === "completed"
          ? `Resume processed: ${ingested.chunkCount} chunks, ${ingested.evidenceCount} evidence records.`
          : `Resume accepted with status ${ingested.status}.`,
      );
      if (inputRef.current) inputRef.current.value = "";
      await loadResumes();
      await onIngested?.();
    } finally {
      setUploading(false);
    }
  }

  async function openResume(resumeId: string) {
    if (!identity) return;
    const result = await api.GET("/v1/candidates/{candidateId}/resumes/{resumeId}/read-reference", {
      params: { path: { candidateId, resumeId } },
      headers: tenantHeaders(identity),
    });
    if (result.error || !result.data?.url) {
      setMessage(apiErrorMessage(result, "Resume file reference could not be created"));
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[13px] font-semibold">Resume ingestion</h2>
          <p className="mt-1 max-w-xl text-[9px] leading-4 text-slate-500">
            PDF, DOCX or UTF-8 text is stored, extracted, parsed, chunked and converted into candidate evidence. Resume-derived skills stay unverified until corroborated.
          </p>
        </div>
        {canManageResume ? (
          <label className={`inline-flex h-9 cursor-pointer items-center rounded-lg bg-indigo-600 px-3 text-[10px] font-semibold text-white ${uploading ? "pointer-events-none opacity-60" : ""}`}>
            {uploading ? "Processing…" : "Upload resume"}
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              className="sr-only"
              disabled={uploading || !identity}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadResume(file);
              }}
            />
          </label>
        ) : null}
      </div>

      {applicationId ? (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[9px] text-slate-500">
          New uploads will be linked to the selected application.
        </div>
      ) : null}
      {message ? <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-[9px] text-indigo-800">{message}</div> : null}

      <div className="mt-4 space-y-2">
        {loading ? <div className="text-[10px] text-slate-400">Loading resume history…</div> : null}
        {!loading && resumes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-[10px] text-slate-400">
            No resume has been ingested for this candidate yet.
          </div>
        ) : null}
        {resumes.map((resume) => (
          <div key={resume.id} className="rounded-xl border border-slate-100 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold text-slate-800">{resume.originalFilename}</div>
                <div className="mt-1 text-[8px] text-slate-400">
                  {formatBytes(resume.byteSize)}{resume.pageCount ? ` · ${resume.pageCount} pages` : ""} · {new Date(resume.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={statusTone(resume.status)}>{resume.status}</Pill>
                <button type="button" onClick={() => void openResume(resume.id)} className="text-[9px] font-semibold text-indigo-600">
                  Open file
                </button>
              </div>
            </div>

            {resume.status === "completed" ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-[8px] text-slate-400">Chunks</div><div className="mt-1 text-[11px] font-semibold">{resume.chunkCount}</div></div>
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-[8px] text-slate-400">Embedded</div><div className="mt-1 text-[11px] font-semibold">{resume.embeddedChunkCount}</div></div>
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-[8px] text-slate-400">Evidence</div><div className="mt-1 text-[11px] font-semibold">{resume.evidenceCount}</div></div>
                <div className="rounded-lg bg-slate-50 p-2"><div className="text-[8px] text-slate-400">Skills parsed</div><div className="mt-1 text-[11px] font-semibold">{resume.structuredProfile.skills.length}</div></div>
              </div>
            ) : null}

            {resume.status === "completed" && resume.chunkCount > 0 && resume.embeddedChunkCount === 0 ? (
              <div className="mt-2 text-[8px] leading-4 text-amber-700">
                Text/evidence ingestion completed; embeddings are disabled in this environment.
              </div>
            ) : null}
            {resume.status === "failed" ? (
              <div className="mt-2 rounded-lg bg-rose-50 p-2 text-[8px] leading-4 text-rose-700">
                {resume.failureMessage || resume.failureCode || "Resume processing failed."}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Panel>
  );
}
