<?php

declare(strict_types=1);

namespace App\Services\Search;

use App\Models\Addressbook;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\Card;
use App\Models\SearchDocument;
use Illuminate\Database\Eloquent\Collection;

/**
 * Links existing CalDAV and CardDAV search rows to the collection and object
 * they were indexed from, so search can check both are still live. Rows that
 * no longer match a live collection keep NULL ids and stay out of results;
 * the next reindex removes them. Safe to run again.
 */
final class SearchDocumentCollectionBackfill
{
    private const KEY_CHUNK = 500;

    public function __construct(private DavSourceKeys $keys) {}

    public function run(): void
    {
        CalendarInstance::query()->chunkById(200, function (Collection $instances): void {
            foreach ($instances as $instance) {
                $prefix = $this->keys->collectionPrefix((string) $instance->principaluri, (string) $instance->uri);
                if ($prefix === null) {
                    continue;
                }
                $objectIds = CalendarObject::query()->where('calendarid', $instance->calendarid)->pluck('id', 'uri')->all();
                $this->link('caldav', $prefix, (int) $instance->id, $objectIds);
            }
        });

        Addressbook::query()->chunkById(200, function (Collection $books): void {
            foreach ($books as $book) {
                $prefix = $this->keys->collectionPrefix((string) $book->principaluri, (string) $book->uri);
                if ($prefix === null) {
                    continue;
                }
                $cardIds = Card::query()->where('addressbookid', $book->id)->pluck('id', 'uri')->all();
                $this->link('carddav', $prefix, (int) $book->id, $cardIds);
            }
        });
    }

    /**
     * @param  array<array-key, mixed>  $objectIdsByUri  object id by stored uri
     */
    private function link(string $sourceType, string $prefix, int $collectionId, array $objectIdsByUri): void
    {
        $objectIdsByKey = [];
        foreach ($objectIdsByUri as $uri => $id) {
            if (is_numeric($id)) {
                $objectIdsByKey[$prefix.rawurldecode((string) $uri)] = (int) $id;
            }
        }

        foreach (array_chunk(array_keys($objectIdsByKey), self::KEY_CHUNK) as $sourceKeys) {
            $rows = SearchDocument::query()
                ->where('source_type', $sourceType)
                ->whereIn('source_key', $sourceKeys)
                ->whereNull('object_id')
                ->get(['id', 'source_key']);
            foreach ($rows as $row) {
                $objectId = $objectIdsByKey[$row->source_key] ?? null;
                if ($objectId === null) {
                    continue;
                }
                SearchDocument::query()->whereKey($row->id)->update([
                    'collection_id' => $collectionId,
                    'object_id' => $objectId,
                ]);
            }
        }
    }
}
