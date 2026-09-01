import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "contacts-workspace.tsx"), "utf8");
const css = readFileSync(join(here, "contacts-workspace.css"), "utf8");
const avatarCss = readFileSync(join(here, "contact-user-avatar.css"), "utf8");
const groupIconCss = readFileSync(join(here, "contacts-group-icon.css"), "utf8");
const orgIconCss = readFileSync(join(here, "contacts-org-icon.css"), "utf8");
const groupRows = readFileSync(join(here, "contacts-sidebar-group-rows.tsx"), "utf8");
const actionBar = readFileSync(join(here, "contacts-detail-action-bar.tsx"), "utf8");
const addressBookSelect = readFileSync(join(here, "contacts-address-book-select.tsx"), "utf8");

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
    expect(tsx).toMatch(/title=\{L\.sidebarSharedWithMe\}/);
    expect(tsx).toMatch(/L\.sidebarSharedWithMe/);
    expect(tsx).not.toMatch(/title=\{L\.sectionGroups\}/);
    expect(tsx).toMatch(/groups: contactGroups/);
    expect(tsx).toMatch(/onSelectGroup=/);
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
    expect(css).toMatch(/\.contacts-workspace \{[\s\S]*--switch-on-bg:\s*var\(--contacts-accent\)/);
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

  it("reuses the shared collection color row in the address book dialog", () => {
    const dialogTsx = readFileSync(join(here, "contacts-addressbook-dialog.tsx"), "utf8");
    expect(dialogTsx).toMatch(/NameColorRow/);
    expect(dialogTsx).toMatch(/SwatchColorPicker/);
    expect(dialogTsx).toMatch(/persistAddressBookColor/);
    expect(dialogTsx).not.toMatch(/onDelete=/);
  });

  it("lets reserved FieldLabelRow align address type with street, trash at the control", () => {
    expect(css).not.toMatch(/\.contacts-detail-view__channel-row--address \{\s*@apply items-end;/);
    expect(css).toMatch(/\.contacts-detail-view__address-remove \{\s*@apply self-end;/);
    expect(css).toMatch(
      /\.contacts-detail-view__channel-type \.field-label-row \{\s*@apply w-full min-w-0;/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__address-entry \{\s*@apply flex flex-col;\s*gap:\s*var\(--contacts-field-stack-gap\);/,
    );
  });

  it("does not override context-select radius or force a compact type face", () => {
    expect(css).not.toMatch(
      /\.select-trigger\.contacts-detail-view__context-select \{[\s\S]*border-radius:/,
    );
    expect(css).not.toMatch(/\.contacts-detail-view__context-select \{[\s\S]*?text-xs/);
    expect(css).toMatch(
      /\.contacts-detail-view__context-select-item \{[\s\S]*font-size:\s*var\(--input-font-size, 1rem\)/,
    );
  });

  it("groups FieldLabelRow tighter than the field stack so labels stick to their input", () => {
    expect(css).toMatch(/--contacts-field-gap:\s*0\.375rem;/);
    expect(css).toMatch(/--contacts-field-stack-gap:\s*1rem;/);
    expect(css).toMatch(
      /\.contacts-detail-view \.field-label-row \{[\s\S]*?@apply mb-0 flex flex-col space-y-0;[\s\S]*?gap:\s*var\(--contacts-field-gap\);/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__field-stack \{[\s\S]*?gap:\s*var\(--contacts-field-stack-gap\);/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__name-row,[\s\S]*?\.contacts-detail-view__job-row \{[\s\S]*?gap:\s*var\(--contacts-field-stack-gap\);/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__address-fields \{[\s\S]*?row-gap:\s*var\(--contacts-field-stack-gap\);/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__address-locality-row \{[\s\S]*?row-gap:\s*var\(--contacts-field-stack-gap\);/,
    );
    expect(css).toMatch(
      /\.contacts-detail-view__channel-list,[\s\S]*?\.contacts-detail-view__address-list \{[\s\S]*?gap:\s*0\.75rem;/,
    );
    expect(css).not.toMatch(
      /\.contacts-detail-view__address-entry \{\s*@apply flex flex-col gap-2;/,
    );
    expect(css).not.toMatch(/\.contacts-detail-view__address-fields \{[\s\S]*?row-gap:\s*0\.5rem;/);
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

  it("stacks postal and city full-width below the md overlay breakpoint", () => {
    expect(css).toMatch(
      /\.contacts-detail-view__address-locality-row \{[\s\S]*?grid-template-columns:\s*minmax\(5\.5rem, 7rem\) minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /@media \(max-width: 47\.999rem\) \{[\s\S]*\.contacts-detail-view__address-locality-row \{[\s\S]*@apply grid-cols-1/,
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
    expect(detailView).toMatch(/collectionTint: groupAddressBookColor\(group, colorOverrides\)/);
    expect(css).toMatch(/\.contacts-detail-view__tag-group/);
  });

  it("washes person avatars from the card's address-book color, not mint-only", () => {
    expect(avatarCss).toMatch(
      /--user-avatar-bg:\s*color-mix\(\s*in oklab,\s*var\(--contacts-book-color,\s*var\(--contacts-accent\)\) 24%,\s*var\(--color-cream/,
    );
    expect(avatarCss).toMatch(/--user-avatar-fg:\s*var\(--color-ink\)/);
    expect(css).not.toMatch(/--contacts-person-avatar-bg/);
    expect(css).not.toMatch(/--contacts-list-avatar-bg:\s*var\(--contacts-accent\)/);
    expect(css).not.toMatch(
      /\.contacts-list-panel__avatar \.user-avatar__mark \{[\s\S]*background-color:\s*var\(--contacts-list-avatar-bg\)/,
    );
  });

  it("rings person and org avatars with a 2px book-color tint", () => {
    expect(avatarCss).toMatch(
      /--user-avatar-border:\s*color-mix\(\s*in oklab,\s*var\(--contacts-book-color,\s*var\(--contacts-accent\)\) 55%,\s*var\(--color-cream/,
    );
    expect(avatarCss).toMatch(/--user-avatar-border-width:\s*2px;/);
    expect(avatarCss).not.toMatch(/--contacts-person-avatar-border/);
    expect(css).not.toMatch(/--contacts-person-avatar-border/);
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
    expect(groupRows).toMatch(/nested=\{nested\}/);
    expect(tsx).toMatch(/addressBookIds=\{editingGroup\?\.addressBookIds\}/);
    expect(tsx).toMatch(/books=\{addressBooks\}/);
  });

  it("aligns small-screen detail gutters with the action-bar px-4, not the stacked pane px-6", () => {
    expect(css).toMatch(/\.contacts-detail-view \{[\s\S]*?@apply px-4 pt-6 pb-10 md:px-6;/);
    expect(css).toMatch(
      /\.workspace-detail-pane__scroll:has\(\.contacts-detail-view\) \{[\s\S]*px-0/,
    );
    expect(css).not.toMatch(/\.contacts-detail-view \{[\s\S]*?padding:\s*1\.5rem 1\.5rem 2\.5rem;/);
  });

  it("keeps a single modest gutter in the md split, not stacked 3rem + md:px-12", () => {
    expect(css).toMatch(/\.contacts-detail-view \{[\s\S]*?md:px-6;/);
    expect(css).toMatch(
      /\.workspace-detail-pane__scroll:has\(\.contacts-detail-view\) \{[\s\S]*md:px-0[\s\S]*md:pt-0[\s\S]*md:pb-0/,
    );
    expect(css).not.toMatch(/padding:\s*2\.5rem 3rem 3rem/);
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

  it("reuses ContactsAddressBookSelect from the detail action bar without create", () => {
    expect(tsx).toMatch(/moveAddressBook=/);
    expect(tsx).toMatch(/onMove: moveActiveContactToAddressBook/);
    expect(actionBar).toMatch(/<ContactsAddressBookSelect/);
    expect(actionBar).toMatch(/variant="toolbar"/);
    expect(addressBookSelect).not.toMatch(/onCreateAddressBook|__create_address_book__/);
    expect(css).toMatch(
      /\.contacts-workspace \.action-bar \.contacts-address-book-select \{[\s\S]*--control-radius:\s*var\(--control-radius-button-pill\)/,
    );
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
