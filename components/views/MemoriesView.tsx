"use client";

import StubPage from "./StubPage";

export default function MemoriesView() {
  return (
    <StubPage
      eyebrow="Forge"
      title="Memories"
      description="The memory manager will hold durable facts the model can recall across conversations — things you teach it about yourself, your machines, and your projects. Stored locally, editable, and deletable."
      notes={[
        "Create, edit, and delete individual memories",
        "Inject selected memories into the system prompt per conversation",
        "Search and tag memories",
      ]}
    />
  );
}
