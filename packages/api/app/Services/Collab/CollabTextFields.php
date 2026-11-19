<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Models\CalendarObject;
use Illuminate\Database\Eloquent\Model;

/**
 * What one app gives the shared live-text core: where its stored Yjs state
 * lives and which text fields of a calendar object that state holds.
 */
interface CollabTextFields
{
    /**
     * The text fields, in the fixed order the content tag hashes them.
     *
     * @return list<string>
     */
    public function textFields(CalendarObject $object): array;

    /**
     * The stored state row for this object, or null when it has none. The
     * row has `state`, `object_etag` and `content_etag` columns.
     */
    public function findState(CalendarObject $object): ?Model;

    /**
     * Create or replace the state row of this object.
     *
     * @param  array{state: string, object_etag: string, content_etag: string}  $columns
     */
    public function storeState(CalendarObject $object, array $columns): void;

    /** The largest state this app stores, or null for no cap beyond the request limit. */
    public function maxStateBytes(): ?int;
}
