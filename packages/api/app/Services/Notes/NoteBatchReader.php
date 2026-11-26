<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\CalendarObject;
use App\Services\Notes\Conversion\NoteJournalConverter;

/**
 * Chunked Note/get reads behind {@see NoteRepository::showEach()}.
 */
final class NoteBatchReader
{
    /** Notes read per query in {@see each()}: bounds the iCalendar bytes held at once. */
    private const GET_CHUNK = 50;

    public function __construct(
        private readonly NotebookRepository $notebooks,
        private readonly NoteJournalConverter $converter,
        private readonly NoteYjsProjection $yjsProjection,
        private readonly JmapNoteStateService $noteStates,
    ) {}

    /**
     * Notes by id for Note/get: the notebook access lookup is read once, notes load
     * in chunks (one query for the rows, one for the stars, one batched state write),
     * and each note is yielded as it is mapped so the caller can project it and drop
     * it. The content tag comes from the parsed note, so a note is parsed once.
     * Yields id => note, or null for a note that is missing or not accessible.
     *
     * @param  list<string>  $noteIds
     * @param  \Closure(string): ?CalendarObject  $findAccessibleObject  resolves a note the chunk lookup missed
     * @return \Generator<string, array<string, mixed>|null>
     */
    public function each(string $username, array $noteIds, \Closure $findAccessibleObject): \Generator
    {
        $instances = $this->notebooks->accessibleInstancesByCalendarId($username);
        foreach (array_chunk($noteIds, self::GET_CHUNK) as $chunk) {
            $objects = $instances === [] ? collect() : CalendarObject::query()
                ->whereIn('uid', $chunk)
                ->where('componenttype', 'VJOURNAL')
                ->whereIn('calendarid', array_keys($instances))
                ->orderBy('id')
                ->get();

            // The first accessible row of a uid wins, as findAccessibleNote() did.
            $byUid = $objects->unique(static fn (CalendarObject $o): string => (string) $o->uid)
                ->keyBy(static fn (CalendarObject $o): string => (string) $o->uid);
            $objectIds = array_values($byUid->map(static fn (CalendarObject $o): int => (int) $o->id)->all());
            $starred = NoteStarLookup::objectIds($username, $objectIds);

            $remember = [];
            $notes = [];
            foreach ($chunk as $noteId) {
                $object = $byUid->get($noteId);
                if ($object === null) {
                    // A miss may still match through the database's case-insensitive collation.
                    $object = $findAccessibleObject($noteId);
                    if ($object === null) {
                        continue;
                    }
                    $starred += NoteStarLookup::objectIds($username, [(int) $object->id]);
                }
                $instance = $instances[(int) $object->calendarid] ?? null;
                if ($instance === null) {
                    continue;
                }
                $notebookUri = $this->notebooks->apiIdForInstance($instance);
                $note = $this->converter->fromObject($object, $notebookUri, isset($starred[(int) $object->id]));
                $note['contentEtag'] = $this->yjsProjection->contentEtagOfNote($note);
                $notes[$noteId] = $note;
                $remember[] = [
                    'noteId' => (string) ($note['id'] ?? $object->uid),
                    'notebookUri' => $notebookUri,
                    'objectUri' => is_string($object->uri) ? (string) $object->uri : null,
                ];
            }
            unset($byUid, $objects);
            $this->noteStates->rememberMany($username, $remember);

            foreach ($chunk as $noteId) {
                yield $noteId => $notes[$noteId] ?? null;
                unset($notes[$noteId]);
            }
        }
    }
}
