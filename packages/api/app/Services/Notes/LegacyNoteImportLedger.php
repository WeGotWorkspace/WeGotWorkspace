<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarObject;
use App\Models\LegacyNoteImport;
use App\Services\Notes\Conversion\NoteJournalConverter;
use Illuminate\Support\Facades\Schema;
use Ramsey\Uuid\Uuid;

/**
 * Remembers which v0.1.96 `.notes/*.md` files became notes, so the import can
 * run from the update and from the command, again and again, without
 * duplicating them or bringing back a note someone deleted (#1773).
 */
final class LegacyNoteImportLedger
{
    public const TABLE = 'notes_legacy_imports';

    /** Fixed forever: a source path must always map to the same note UID. */
    private const UID_NAMESPACE = '8c3e7f52-2b1d-5f0a-9a64-0d5b4f7c1e93';

    /** @var array<int, array<string, list<string>>> calendar id → title/body key → unclaimed UIDs */
    private array $unclaimed = [];

    private ?bool $hasTable = null;

    public function __construct(private readonly NoteJournalConverter $converter) {}

    public function uidFor(string $virtualPath): string
    {
        return Uuid::uuid5(self::UID_NAMESPACE, $virtualPath)->toString();
    }

    /** UID of the note this file was recorded as, or null. */
    public function recordedUid(string $virtualPath): ?string
    {
        if (! $this->hasTable()) {
            return null;
        }
        $uid = LegacyNoteImport::query()->whereKey(hash('sha256', $virtualPath))->value('note_uid');

        return is_string($uid) && $uid !== '' ? $uid : null;
    }

    public function noteExists(string $uid): bool
    {
        return CalendarObject::query()->where('uid', $uid)->exists();
    }

    public function record(string $virtualPath, string $uid): void
    {
        if (! $this->hasTable()) {
            return;
        }
        LegacyNoteImport::query()->insertOrIgnore([
            'path_hash' => hash('sha256', $virtualPath),
            'source_path' => $virtualPath,
            'note_uid' => $uid,
            'imported_at' => time(),
        ]);
    }

    /**
     * Before #1773 the command gave each note a random UID and recorded
     * nothing. A note in the target notebook with the same title and body,
     * not yet claimed by another file, is taken to be that earlier import.
     */
    public function claimEarlierImport(int $calendarId, string $title, string $body): ?string
    {
        if (trim($title) === '' && trim($body) === '') {
            return null; // Two blank notes say nothing about each other.
        }
        $key = $this->contentKey($title, $body);
        $this->unclaimed[$calendarId] ??= $this->unclaimedNotes($calendarId);
        if (($this->unclaimed[$calendarId][$key] ?? []) === []) {
            return null;
        }

        return array_shift($this->unclaimed[$calendarId][$key]);
    }

    /**
     * @return array<string, list<string>>
     */
    private function unclaimedNotes(int $calendarId): array
    {
        $claimed = $this->hasTable()
            ? array_flip(LegacyNoteImport::query()->pluck('note_uid')->map(fn ($uid): string => (string) $uid)->all())
            : [];
        $byContent = [];
        CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('componenttype', 'VJOURNAL')
            ->orderBy('id')
            ->get(['uid', 'calendardata'])
            ->each(function (CalendarObject $object) use ($claimed, &$byContent): void {
                $uid = (string) $object->uid;
                if ($uid === '' || isset($claimed[$uid])) {
                    return;
                }
                $note = $this->converter->fromIcs((string) $object->calendardata, $uid);
                $byContent[$this->contentKey((string) ($note['title'] ?? ''), (string) ($note['body'] ?? ''))][] = $uid;
            });

        return $byContent;
    }

    private function contentKey(string $title, string $body): string
    {
        return trim($title)."\0".rtrim(str_replace("\r\n", "\n", $body));
    }

    private function hasTable(): bool
    {
        return $this->hasTable ??= Schema::connection('wgw')->hasTable(self::TABLE);
    }
}
