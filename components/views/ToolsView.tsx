"use client";

import StubPage from "./StubPage";

export default function ToolsView() {
  return (
    <StubPage
      description="Tools are callable functions the model can invoke — file read/write, shell commands, web fetch. They differ from skills: a skill teaches the model how to approach a job, a tool gives it a capability to act with. Skills will often call tools."
      notes={[
        "Built-in tools: file create/read/write, shell exec (sandboxed), fetch",
        "Define custom tools with a JSON schema + handler",
        "Per-workspace allowlists so an agent only gets the tools you grant",
      ]}
    />
  );
}
