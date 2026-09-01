"use client";

import { useEffect, useState } from "react";
import { CandidateInterviewExperience } from "../../../components/candidate/candidate-interview-experience";
import { CandidateRealtimeLaunchGate } from "../../../components/candidate/candidate-realtime-launch-gate";

export default function CandidateInterviewPage() {
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    void fetch("/api/backend/v1/candidate-auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    }).then((response) => {
      if (!response.ok) {
        window.location.replace("/candidate/login");
        return;
      }
      setAuthorized(true);
    });
  }, []);

  if (!authorized) {
    return <main className="grid min-h-screen place-items-center text-sm text-slate-500">Verifying candidate session…</main>;
  }

  return (
    <>
      <CandidateRealtimeLaunchGate />
      <CandidateInterviewExperience />
    </>
  );
}
