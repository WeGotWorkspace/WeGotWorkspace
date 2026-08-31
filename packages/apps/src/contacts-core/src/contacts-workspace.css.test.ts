import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "contacts-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "contacts-workspace.css"), "utf8");
const groupIconCss = readFileSync(join(here, "contacts-group-icon.css"), "utf8");
const orgIconCss = readFileSync(join(here, "contacts-org-icon.css"), "utf8");
const groupRows = readFileSync(join(here, "contacts-sidebar-group-rows.tsx"), "utf8");

describe("contacts workspace sidebar chrome", () => {
  it("puts New group on the shared segmented New menu, not a section +", () => {
    expect(tsx).toMatch(/<ContactsNewMenu/);
    expect(tsx).toMatch(
      /onCreateGroup=\{canCreateGroup \? \(\) => setCreateGroupDialog\(true\) : undefined\}/,
    );
    expect(tsx).toMatch(
      /onImportVcf=\{canImportVcf \? \(\) => fileInputRef\.current\?\.click\(\) : undefined\}/,
    );
    expect(tsx).toMatch(/<ContactsImportDialog/);
    expect(tsx).toMatch(/onImport=\{submitImportDialog\}/);
    expect(tsx).toMatch(/accept=\{VCF_FILE_ACCEPT\}/);
    expect(tsx).not.toMatch(/onAdd=\{canCreateGroup/);
    expect(tsx).not.toMatch(/addLabel=\{L\.newGroup\}/);
    expect(tsx).not.toMatch(/create-book|onCreateAddressBook/);
  });

  it("does not keep leftover Add-row button chrome on the detail pane", () => {
    expect(css).not.toMatch(/\.contacts-detail-view__add-row/);
    expect(tsx).not.toMatch(/onAddPhone|ContactAddRowButton/);
  });

  it("partitions owned and shared books through CollectionSidebarRow", () => {
    expect(tsx).toMatch(/<ContactsSidebarBookRows/);
    expect(tsx).toMatch(/ownedAddressBooks/);
    expect(tsx).toMatch(/sharedAddressBooks/);
    expect(tsx).toMatch(/L\.sidebarSharedWithMe/);
    expect(tsx).toMatch(/L\.sectionGroups/);
    expect(tsx).toMatch(/<ContactsSidebarGroupRows/);
    expect(tsx).toMatch(/onToggleVisibility=\{toggleAddressBookVisibility\}/);
    expect(tsx).toMatch(/hiddenAddressBookIds=\{hiddenAddressBookIds\}/);
    expect(tsx).not.toMatch(/items=\{groupSidebarItems\}/);
    expect(tsx).not.toMatch(/showColorDot/);
  });

  it("uses mint #39d49b for chrome accents, mixed 12% onto cream", () => {
    const accent = css.match(
      /\.contacts-workspace \{[\s\S]*?--contacts-accent:\s*(#[0-9a-fA-F]{6})/,
    )?.[1];
    expect(accent?.toLowerCase()).toBe("#39d49b");
    expect(css).toMatch(/\.contacts-dialog-surface \{[\s\S]*?--contacts-accent:\s*#39d49b/i);
    expect(css).not.toMatch(/--contacts-accent:\s*#8b6f45/i);
    expect(css).toMatch(
      /--contacts-sidebar:\s*color-mix\(in oklab,\s*var\(--contacts-accent\) 12%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.contacts-workspace \.app-sidebar__scroll \{[\s\S]*--button-primary-fg:\s*var\(--color-ink/,
    );
  });

  it("keeps idle action icons muted ink, not mint accent", () => {
    const detailPane = css.match(
      /\.contacts-workspace \.workspace-detail-pane \.action-bar,[\s\S]*?\.contacts-workspace \.workspace-detail-pane \{[\s\S]*?\}/,
    )?.[0];
    expect(detailPane).toBeDefined();
    expect(detailPane).toMatch(/--button-primary-bg:\s*var\(--contacts-accent\)/);
    expect(detailPane).not.toMatch(/--button-subtle-color:\s*var\(--contacts-accent/);
    expect(detailPane).not.toMatch(/--button-ghost-color:\s*var\(--contacts-accent/);
    expect(css).toMatch(
      /\.contacts-workspace \.app-sidebar__scroll \{[\s\S]*--button-subtle-color:\s*var\(--color-ink\)/,
    );
  });

  it("washes selected action-bar icons like Calendar Today / Notes Star", () => {
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active \{[\s\S]*--button-active-color:\s*var\(--contacts-accent-strong\)/,
    );
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active \{[\s\S]*--button-subtle-background:[\s\S]*var\(--contacts-accent\) 18%/,
    );
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active \{[\s\S]*--button-subtle-hover-background:[\s\S]*var\(--contacts-accent\) 24%/,
    );
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active[\s\S]*fill:\s*none/,
    );
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*:is\(\.action-bar,\s*\.multi-selection-view__actions\)[\s\S]*\.icon-button--active[\s\S]*color:\s*var\(--contacts-accent-strong\)/,
    );
  });

  it("opens the share-only address book dialog from mutations", () => {
    const dialogBlock = tsx.slice(tsx.indexOf("<ContactsAddressBookDialog"));
    expect(dialogBlock).toMatch(/onPatchShareWith: patchShareWith/);
    expect(dialogBlock).toMatch(/hideSharedAddressBook/);
    expect(dialogBlock).not.toMatch(/onDelete=/);
  });

  it("end-aligns the address top row so type and remove sit with the street input", () => {
    expect(css).toMatch(/\.contacts-detail-view__channel-row--address \{\s*@apply items-end;/);
    expect(css).toMatch(/\.contacts-detail-view__address-entry \{\s*@apply flex flex-col gap-2;/);
  });

  it("reserves the same action-column width on editable rows and address fields", () => {
    expect(css).toMatch(/--contacts-channel-action-size:\s*var\(\s*--control-height-sm,/);
    expect(css).toMatch(
      /\.contacts-detail-view__channel-row--editable \{[\s\S]*?grid-template-columns:\s*7rem minmax\(0, 1fr\) var\(--contacts-channel-action-size\)/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__address-fields \{[\s\S]*?grid-template-columns:\s*7rem minmax\(0, 1fr\) var\(--contacts-channel-action-size\)/,
    );
  });

  it("rejects sidebar group drops that are not in the contact's address book", () => {
    expect(tsx).toMatch(/contactAndGroupShareAddressBook\(card, group\)/);
    expect(tsx).toMatch(/ids\.every/);
  });

  it("reuses the shared TagGroup on the person detail card for groups", () => {
    expect(tsx).toMatch(/contactDetailGroupTags\(/);
    expect(tsx).toMatch(/groupTags=\{/);
    expect(tsx).toMatch(/onAdd: addActiveGroupTag/);
    expect(tsx).toMatch(/onRemove: removeActiveGroupTag/);
    const detailView = readFileSync(join(here, "contacts-detail-view.tsx"), "utf8");
    expect(detailView).toMatch(/from "@\/tag\/src\/tag"/);
    expect(detailView).toMatch(/<TagGroup/);
    expect(detailView).toMatch(/collectionTint: groupAddressBookColor\(group\)/);
    expect(css).toMatch(/\.contacts-detail-view__tag-group/);
  });

  it("uses one soft accent wash for person avatars in list and detail", () => {
    expect(css).toMatch(
      /--contacts-person-avatar-bg:\s*color-mix\(\s*in oklab,\s*var\(--contacts-accent\) 24%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.contacts-list-panel__avatar,\s*\.contacts-detail-view__avatar \{[\s\S]*--user-avatar-bg:\s*var\(--contacts-person-avatar-bg\);[\s\S]*--user-avatar-fg:\s*var\(--contacts-person-avatar-color\);/,
    );
    expect(css).not.toMatch(/--contacts-list-avatar-bg:\s*var\(--contacts-accent\)/);
    expect(css).not.toMatch(
      /\.contacts-list-panel__avatar \.user-avatar__mark \{[\s\S]*background-color:\s*var\(--contacts-list-avatar-bg\)/,
    );
  });

  it("rings person and org avatars with a 2px saturated accent tint", () => {
    expect(css).toMatch(
      /--contacts-person-avatar-border:\s*color-mix\(\s*in oklab,\s*var\(--contacts-accent\) 55%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.contacts-list-panel__avatar,\s*\.contacts-detail-view__avatar \{[\s\S]*--user-avatar-border:\s*var\(--contacts-person-avatar-border\);[\s\S]*--user-avatar-border-width:\s*2px;/,
    );
    expect(css).not.toMatch(/--contacts-person-avatar-border:\s*#39d49b/);
    expect(css).not.toMatch(/--contacts-person-avatar-border:\s*var\(--color-ink/);
    expect(groupIconCss).not.toMatch(/--user-avatar-border/);
    expect(groupIconCss).not.toMatch(/border-width:\s*2px/);
  });

  it("paints the sidebar mark in mint tints, not ink or leftover gold", () => {
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*--app-switch-icon-bg:\s*var\(--contacts-accent\)/,
    );
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*\.app-switch-button__icon\.workspace-app-icon--switch-trigger \{[\s\S]*--app-switch-icon-fg:\s*color-mix\(\s*in oklab,\s*var\(--contacts-accent\) 14%,\s*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-fg:\s*var\(--app-switch-icon-fg\)/,
    );
    expect(css).toMatch(
      /\.contacts-workspace[\s\S]*\.workspace-app-icon--switch-trigger[\s\S]*svg \{[\s\S]*--wai-cutout:\s*#26a577/,
    );
    const lockup = css.slice(css.indexOf("App switcher lockup"));
    const lockupEnd = lockup.indexOf(".contacts-list-panel__loading");
    const lockupBlock = lockupEnd === -1 ? lockup : lockup.slice(0, lockupEnd);
    expect(lockupBlock).not.toMatch(/--color-ink/);
    expect(lockupBlock).not.toMatch(/--contacts-accent-strong/);
    expect(lockupBlock).not.toMatch(/#8[Bb]6[Ff]45|#b5c96a|#000\b|#111|#333/);
  });

  it("tints group icons from --collection-row-color, not the mint app accent", () => {
    expect(groupIconCss).toMatch(/color:\s*var\(--collection-row-color,\s*var\(--color-ink\)\)/);
    expect(groupIconCss).not.toMatch(/--contacts-accent|#39d49b/);
    expect(orgIconCss).toMatch(/color:\s*var\(--user-avatar-fg,\s*var\(--color-ink\)\)/);
    expect(orgIconCss).not.toMatch(/--collection-row-color/);
    expect(groupRows).toMatch(/<ContactsGroupIcon book=\{group\}/);
    expect(tsx).toMatch(/addressBookIds=\{editingGroup\?\.addressBookIds\}/);
    expect(tsx).toMatch(/books=\{addressBooks\}/);
  });

  it("lays out the detail identity as a row so tags sit below the avatar stack", () => {
    expect(css).toMatch(
      /\.contacts-detail-view__header \{\s*@apply mb-8 flex flex-col items-stretch gap-3;/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__identity \{[\s\S]*--contacts-detail-avatar-size:\s*5rem;[\s\S]*@apply flex items-center gap-4;/,
    );
    expect(css).toMatch(/\.contacts-detail-view__heading \{\s*@apply flex min-w-0 flex-1 flex-col/);
    expect(groupIconCss).toMatch(/\.contacts-group-icon-slot--xl \{\s*@apply size-20;/);
  });

  it("hosts group delete in the edit dialog, not the list header or create dialog", () => {
    expect(tsx).toMatch(/<ContactsEditGroupDialog/);
    expect(tsx).toMatch(/canDelete=\{canDeleteEditingGroup\}/);
    expect(tsx).toMatch(/onDelete=\{/);
    expect(tsx).not.toMatch(/openGroupRenameDialog/);
    expect(tsx).not.toMatch(/onDeleteGroup:/);
    const createBlock = tsx.slice(
      tsx.indexOf("<ContactsCreateGroupDialog"),
      tsx.indexOf("<ContactsAddressBookDialog"),
    );
    expect(createBlock).not.toMatch(/onDelete/);
  });
});
