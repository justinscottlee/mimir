"use client";

import StubPage from "./StubPage";

export default function SkillsView() {
  return (
    <StubPage
      description="Skills are reusable instruction packs the model can load on demand — the skills.sh format is a good fit here. Each skill is a folder with a SKILL.md plus any scripts or references it needs."
      notes={[
        "Import a skill from a folder, zip, or git URL",
        "Toggle skills on or off per conversation or workspace",
        "Author new skills in-app with a SKILL.md editor",
      ]}
    />
  );
}
