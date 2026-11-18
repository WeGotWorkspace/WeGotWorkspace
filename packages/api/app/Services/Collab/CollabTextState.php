<?php

declare(strict_types=1);

namespace App\Services\Collab;

use App\Exceptions\ApiHttpException;
use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarObject;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * The live-text rules every calendar-object app shares (Notes, Tasks): the
 * content tag, the state precondition, the outside-write guards, the locked
 * transaction and the state row. The app only says which fields it holds,
 * through {@see CollabTextFields}.
 */
final class CollabTextState
{
    /**
     * `sha1` of the fields joined with "\0", in the order the app gives.
     * Notes passes `[body, title ?? '']`, the hash its stored rows already hold.
     *
     * @param  list<string>  $fields
     */
    public static function hashFields(array $fields): string
    {
        return hash('sha1', implode("\0", $fields));
    }

    /** The quoted tag of the object's current text. Metadata does not change it. */
    public function contentTag(CollabTextFields $app, CalendarObject $object): string
    {
        return '"'.self::hashFields($app->textFields($object)).'"';
    }

    public function objectEtag(CalendarObject $object): string
    {
        return OptimisticConcurrency::formatEtag((string) $object->etag) ?? (string) $object->etag;
    }

    /** The tag of a stored state: it moves only when the bytes move. */
    public function stateEtag(Model $row): string
    {
        return DocCollabDocumentService::sidecarEtag($this->stateBytes($row));
    }

    public function stateBytes(Model $row): string
    {
        $value = $row->getAttributes()['state'] ?? $row->getAttribute('state');
        if (is_resource($value)) {
            $contents = stream_get_contents($value);

            return is_string($contents) ? $contents : '';
        }

        return is_string($value) ? $value : '';
    }

    /**
     * Run `$write` with the object row locked, then its state row read under
     * that lock. Both are read again here, so nothing the caller looked up
     * before the lock decides the write.
     *
     * @template T
     *
     * @param  callable(CalendarObject, Model|null): T  $write
     * @return T
     */
    public function locked(CollabTextFields $app, CalendarObject $object, string $notFound, callable $write): mixed
    {
        return DB::connection('wgw')->transaction(function () use ($app, $object, $notFound, $write): mixed {
            $locked = CalendarObject::query()
                ->whereKey($object->getKey())
                ->lockForUpdate()
                ->first();
            if ($locked === null) {
                throw new ApiHttpException(404, $notFound, 'not_found');
            }

            return $write($locked, $app->findState($locked));
        });
    }

    /**
     * `428` without a precondition while a state exists; `412` on
     * `If-None-Match: *` over an existing state or an `If-Match` mismatch.
     */
    public function assertStatePrecondition(?string $ifMatch, ?string $ifNoneMatch, ?string $storedEtag): void
    {
        $ifMatch = trim((string) $ifMatch);
        $ifNoneMatch = trim((string) $ifNoneMatch);

        if ($ifMatch === '' && $ifNoneMatch === '') {
            if ($storedEtag !== null) {
                throw new ApiHttpException(
                    428,
                    'If-Match or If-None-Match is required.',
                    'precondition_required',
                );
            }

            return;
        }

        if ($ifNoneMatch === '*' && $storedEtag !== null) {
            throw new ApiHttpException(412, 'Yjs state already exists.', 'precondition_failed');
        }
        if ($ifMatch !== '' && ! OptimisticConcurrency::ifMatchSatisfied($ifMatch, $storedEtag)) {
            throw new ApiHttpException(412, 'Yjs state etag does not match If-Match.', 'precondition_failed');
        }
    }

    /**
     * True when the object moved on and its text is not the text the state
     * was written from. A matching content tag is a metadata change: the
     * state is still an ancestor of the object.
     */
    public function isExternalContentWrite(CollabTextFields $app, Model $row, CalendarObject $object): bool
    {
        if ($this->sameEtag((string) $row->getAttribute('object_etag'), $this->objectEtag($object))) {
            return false;
        }

        $stored = $row->getAttribute('content_etag');
        if (! is_string($stored) || $stored === '') {
            return true;
        }

        return $stored !== self::hashFields($app->textFields($object));
    }

    /**
     * #1381: an `X-Wgw-External-Write` acknowledgement names the text the
     * client showed. Unlike `If-Match`, `*` would acknowledge any outside
     * text unseen, so it never matches.
     */
    public function namesContent(CollabTextFields $app, string $header, CalendarObject $object): bool
    {
        $current = $this->contentTag($app, $object);
        foreach (explode(',', $header) as $candidate) {
            $candidate = trim($candidate);
            if (str_starts_with($candidate, 'W/')) {
                $candidate = substr($candidate, 2);
            }
            if ($candidate !== '' && $candidate !== '*' && hash_equals($current, $candidate)) {
                return true;
            }
        }

        return false;
    }

    /**
     * A save must not write over text its client never saw.
     *
     * - With a state row: while the object holds an outside write, the save
     *   must name that text in `X-Wgw-External-Write` (#1381).
     * - Without one (first-save check): a save that names the tag it seeded
     *   from is refused when the text has moved on since. A save that names
     *   nothing is a first save from a client that does not send the check.
     */
    public function assertNoUnseenExternalWrite(
        CollabTextFields $app,
        ?Model $row,
        CalendarObject $object,
        ?string $externalWriteSeen,
    ): void {
        $seen = trim((string) $externalWriteSeen);
        if ($row === null) {
            if ($seen === '' || $this->namesContent($app, $seen, $object)) {
                return;
            }
        } elseif (! $this->isExternalContentWrite($app, $row, $object) || $this->namesContent($app, $seen, $object)) {
            return;
        }

        // The message is the code too: the shared client reads `error`.
        throw new ApiHttpException(409, 'external_write', 'external_write');
    }

    /** `413 state_too_large` above the app's cap. */
    public function assertStateSize(CollabTextFields $app, string $bytes): void
    {
        $max = $app->maxStateBytes();
        if ($max !== null && strlen($bytes) > $max) {
            throw new ApiHttpException(413, 'The collaboration state is too large.', 'state_too_large');
        }
    }

    /**
     * Store the state beside the object as it is now, and return the state
     * tag the client sends as `If-Match` next time.
     */
    public function store(CollabTextFields $app, CalendarObject $object, string $bytes): string
    {
        $this->assertStateSize($app, $bytes);
        $app->storeState($object, [
            'state' => $bytes,
            'object_etag' => $this->objectEtag($object),
            'content_etag' => self::hashFields($app->textFields($object)),
        ]);

        return DocCollabDocumentService::sidecarEtag($bytes);
    }

    private function sameEtag(string $stored, string $current): bool
    {
        $left = OptimisticConcurrency::formatEtag($stored) ?? '';
        $right = OptimisticConcurrency::formatEtag($current) ?? '';

        return $left !== '' && $left === $right;
    }
}
