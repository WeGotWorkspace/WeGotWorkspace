<?php

declare(strict_types=1);

namespace App\Services\Search;

use App\Models\CalendarObject;
use App\Models\Card;
use App\Storage\WgwStorage;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VCard;
use Sabre\VObject\Reader;

final class SearchIndexerService
{
    private const MAX_INDEXED_BODY_BYTES = 512000;

    private const FILE_BODY_EXTENSIONS = ['md', 'txt', 'csv', 'wtc'];

    public function __construct(
        private WgwStorage $storage,
        private SearchTokenService $tokens,
        private SearchDocumentStore $store,
    ) {}

    public function indexDavPath(string $path): void
    {
        $normalized = $this->normalizeDavPath($path);
        if ($normalized === '') {
            return;
        }

        if (str_starts_with($normalized, 'files/')) {
            $storageKey = substr($normalized, strlen('files/'));
            if ($storageKey !== '') {
                $this->indexFileStorageKey($storageKey);
            }

            return;
        }

        if (str_starts_with($normalized, 'calendars/')) {
            $this->indexCalendarObjectFromPath($normalized);

            return;
        }

        if (str_starts_with($normalized, 'addressbooks/')) {
            $this->indexCardObjectFromPath($normalized);
        }
    }

    public function deleteDavPath(string $path): void
    {
        $normalized = $this->normalizeDavPath($path);
        if ($normalized === '') {
            return;
        }

        if (str_starts_with($normalized, 'files/')) {
            $storageKey = substr($normalized, strlen('files/'));
            if ($storageKey === '') {
                return;
            }
            $this->deleteFileLikeDocuments($storageKey);

            return;
        }

        if (str_starts_with($normalized, 'calendars/')) {
            $sourceKey = $this->calendarSourceKeyFromPath($normalized);
            if ($sourceKey !== null) {
                $this->store->delete('caldav', $sourceKey);
            }

            return;
        }

        if (str_starts_with($normalized, 'addressbooks/')) {
            $sourceKey = $this->cardSourceKeyFromPath($normalized);
            if ($sourceKey !== null) {
                $this->store->delete('carddav', $sourceKey);
            }
        }
    }

    public function indexFileStorageKey(string $storageKey): void
    {
        $key = trim(str_replace('\\', '/', $storageKey), '/');
        if ($key === '') {
            return;
        }
        $disk = $this->storage->files();
        $exists = $disk->fileExists($key) || $disk->directoryExists($key);
        if (! $exists) {
            $this->deleteFileLikeDocuments($key);

            return;
        }

        $segments = explode('/', $key);
        $owner = null;
        $group = null;
        if ($segments[0] === 'users' && isset($segments[1])) {
            $owner = $segments[1];
        } elseif ($segments[0] === 'groups' && isset($segments[1])) {
            $group = $segments[1];
        }
        $isDirectory = $disk->directoryExists($key);
        $isNotePath = $this->isNotePath($key);
        if ($this->isHiddenPath($key) && ! $isNotePath) {
            $this->deleteFileLikeDocuments($key);

            return;
        }
        if ($isDirectory) {
            if ($isNotePath) {
                // Keep .notes containers out of file results.
                $this->deleteFileLikeDocuments($key);

                return;
            }
        }

        $name = basename($key);
        $extension = $isDirectory ? null : strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if ($extension === 'yjs') {
            $this->deleteFileLikeDocuments($key);

            return;
        }
        $sourceType = $isNotePath ? 'note' : 'file';
        if ($sourceType === 'note') {
            $this->store->delete('file', $key);
        } else {
            $this->store->delete('note', $key);
        }
        $category = $isDirectory ? 'folder' : ($isNotePath ? 'note' : $this->categoryForExtension($extension));
        $size = $isDirectory ? 0 : (int) $disk->size($key);
        $modified = (int) $disk->lastModified($key);
        $indexedText = $this->readFileBodyForIndexing($key, $extension, $size, $isDirectory, $isNotePath);
        $body = $indexedText['body'];
        $frontmatter = $indexedText['frontmatter'];

        $metadata = [
            'path' => '/'.$key,
            'kind' => $isDirectory ? 'dir' : 'file',
            'isNote' => $isNotePath,
        ];
        if ($isNotePath) {
            $metadata['noteName'] = pathinfo($name, PATHINFO_FILENAME);
        }
        if ($frontmatter !== null && $frontmatter !== '') {
            $metadata['frontmatter'] = $frontmatter;
        }

        $document = [
            'source_subtype' => $isNotePath ? 'note' : null,
            'owner_username' => $owner,
            'group_slug' => $group,
            'title' => $isNotePath ? ($this->titleFromFrontmatter($frontmatter) ?? $name) : $name,
            'extension' => $extension,
            'category' => $category,
            'content_type' => $isDirectory ? 'inode/directory' : $this->safeMimeType($key),
            'size' => $size,
            'modified_at_ts' => $modified,
            'body_text' => $body,
            'metadata' => $metadata,
        ];
        $tokens = [
            'title' => $this->tokens->tokenize((string) $document['title']),
            'meta' => $this->tokens->tokenize(
                trim($category.' '.$extension.' /'.$key.' '.($frontmatter ?? ''))
            ),
            'body' => $this->tokens->tokenize($body ?? ''),
        ];
        $this->store->upsert($sourceType, $key, $document, $tokens);
    }

    public function indexCalendarObjectFromPath(string $path): void
    {
        $sourceKey = $this->calendarSourceKeyFromPath($path);
        if ($sourceKey === null) {
            return;
        }
        [$principal, $calendarUri, $objectUri] = explode('|', $sourceKey, 3);
        $row = CalendarObject::query()
            ->from('calendarobjects as o')
            ->join('calendarinstances as i', 'i.calendarid', '=', 'o.calendarid')
            ->where('i.principaluri', 'principals/'.$principal)
            ->where('i.uri', $calendarUri)
            ->where('o.uri', $objectUri)
            ->select([
                'i.principaluri',
                'i.uri as calendar_uri',
                'i.displayname as calendar_name',
                'o.uri',
                'o.calendardata',
                'o.componenttype',
                'o.size',
                'o.firstoccurence',
                'o.lastoccurence',
                'o.lastmodified',
            ])
            ->first();

        if ($row === null) {
            $this->store->delete('caldav', $sourceKey);

            return;
        }

        $raw = $row->calendardata;
        $parsed = $this->extractCalendarSearchPayload($raw);
        $calendarName = $row->getAttribute('calendar_name');
        $document = [
            'source_subtype' => is_string($row->componenttype) ? strtolower($row->componenttype) : 'calendar',
            'owner_username' => $principal,
            'title' => $parsed['title'] ?? $objectUri,
            'category' => 'calendar',
            'content_type' => 'text/calendar',
            'size' => (int) ($row->size ?? 0),
            'created_at_ts' => is_numeric($row->firstoccurence ?? null) ? (int) $row->firstoccurence : null,
            'modified_at_ts' => (int) ($row->lastmodified ?? time()),
            'body_text' => $parsed['body'] ?? null,
            'metadata' => [
                'principal' => $principal,
                'calendarUri' => $calendarUri,
                'calendarName' => is_string($calendarName) ? $calendarName : null,
                'objectUri' => $objectUri,
                'componentType' => $row->componenttype,
                'firstOccurrence' => $row->firstoccurence,
                'lastOccurrence' => $row->lastoccurence,
            ],
        ];
        $tokens = [
            'title' => $this->tokens->tokenize((string) $document['title']),
            'meta' => $this->tokens->tokenize(
                implode(' ', [
                    (string) ($parsed['location'] ?? ''),
                    (string) ($parsed['organizer'] ?? ''),
                    implode(' ', $parsed['attendees'] ?? []),
                    implode(' ', $parsed['categories'] ?? []),
                ])
            ),
            'body' => $this->tokens->tokenize((string) ($document['body_text'] ?? '')),
        ];
        $this->store->upsert('caldav', $sourceKey, $document, $tokens);
    }

    public function indexCardObjectFromPath(string $path): void
    {
        $sourceKey = $this->cardSourceKeyFromPath($path);
        if ($sourceKey === null) {
            return;
        }
        [$principal, $bookUri, $cardUri] = explode('|', $sourceKey, 3);
        $row = Card::query()
            ->from('cards as c')
            ->join('addressbooks as a', 'a.id', '=', 'c.addressbookid')
            ->where('a.principaluri', 'principals/'.$principal)
            ->where('a.uri', $bookUri)
            ->where('c.uri', $cardUri)
            ->select([
                'a.principaluri',
                'a.uri as book_uri',
                'a.displayname as book_name',
                'c.uri',
                'c.carddata',
                'c.size',
                'c.lastmodified',
            ])
            ->first();

        if ($row === null) {
            $this->store->delete('carddav', $sourceKey);

            return;
        }

        $raw = is_string($row->carddata) ? $row->carddata : (string) $row->carddata;
        $parsed = $this->extractCardSearchPayload($raw);
        $title = trim(implode(' ', array_filter([
            $parsed['firstName'] ?? null,
            $parsed['lastName'] ?? null,
        ])));
        if ($title === '') {
            $title = (string) ($parsed['fullName'] ?? $cardUri);
        }

        $bodyFragments = [
            $parsed['fullName'] ?? '',
            $parsed['organization'] ?? '',
            $parsed['title'] ?? '',
            $parsed['note'] ?? '',
            implode(' ', $parsed['emails'] ?? []),
            implode(' ', $parsed['phones'] ?? []),
            implode(' ', $parsed['address'] ?? []),
        ];

        $bookName = $row->getAttribute('book_name');
        $document = [
            'owner_username' => $principal,
            'title' => $title,
            'extension' => 'vcf',
            'category' => 'contact',
            'content_type' => 'text/vcard',
            'size' => (int) ($row->size ?? 0),
            'modified_at_ts' => (int) ($row->lastmodified ?? time()),
            'body_text' => trim(implode("\n", array_filter($bodyFragments))),
            'metadata' => [
                'principal' => $principal,
                'addressBookUri' => $bookUri,
                'addressBookName' => is_string($bookName) ? $bookName : null,
                'cardUri' => $cardUri,
                'firstName' => $parsed['firstName'] ?? null,
                'lastName' => $parsed['lastName'] ?? null,
                'city' => $parsed['city'] ?? null,
                'country' => $parsed['country'] ?? null,
            ],
        ];
        $tokens = [
            'title' => $this->tokens->tokenize($title),
            'meta' => $this->tokens->tokenize(implode(' ', $bodyFragments)),
            'body' => $this->tokens->tokenize((string) $document['body_text']),
        ];
        $this->store->upsert('carddav', $sourceKey, $document, $tokens);
    }

    /**
     * @param  callable(int, int, string): void|null  $progress
     */
    public function reindexAll(?callable $progress = null): void
    {
        $this->store->clearAll();

        $allFileKeys = array_values(array_unique(array_merge(
            $this->storage->files()->allDirectories(),
            $this->storage->files()->allFiles()
        )));
        $total = count($allFileKeys);
        $done = 0;
        foreach ($allFileKeys as $key) {
            $done++;
            $this->indexFileStorageKey($key);
            if ($progress !== null) {
                $progress($done, max(1, $total), 'files');
            }
        }

        /** @var list<object{principaluri:string, calendar_uri:string, object_uri:string}> $calendarRows */
        $calendarRows = CalendarObject::query()
            ->from('calendarobjects as o')
            ->join('calendarinstances as i', 'i.calendarid', '=', 'o.calendarid')
            ->selectRaw('i.principaluri as principaluri, i.uri as calendar_uri, o.uri as object_uri')
            ->get()
            ->all();
        $totalCal = count($calendarRows);
        foreach ($calendarRows as $idx => $row) {
            $principal = $this->principalFromUri((string) $row->principaluri);
            if ($principal === null) {
                continue;
            }
            $this->indexCalendarObjectFromPath(
                'calendars/'.$principal.'/'.$row->calendar_uri.'/'.$row->object_uri
            );
            if ($progress !== null) {
                $progress($idx + 1, max(1, $totalCal), 'caldav');
            }
        }

        /** @var list<object{principaluri:string, book_uri:string, card_uri:string}> $cardRows */
        $cardRows = Card::query()
            ->from('cards as c')
            ->join('addressbooks as a', 'a.id', '=', 'c.addressbookid')
            ->selectRaw('a.principaluri as principaluri, a.uri as book_uri, c.uri as card_uri')
            ->get()
            ->all();
        $totalCard = count($cardRows);
        foreach ($cardRows as $idx => $row) {
            $principal = $this->principalFromUri((string) $row->principaluri);
            if ($principal === null) {
                continue;
            }
            $this->indexCardObjectFromPath(
                'addressbooks/'.$principal.'/'.$row->book_uri.'/'.$row->card_uri
            );
            if ($progress !== null) {
                $progress($idx + 1, max(1, $totalCard), 'carddav');
            }
        }
    }

    private function normalizeDavPath(string $path): string
    {
        return trim(str_replace('\\', '/', $path), '/');
    }

    private function categoryForExtension(?string $extension): string
    {
        $ext = strtolower((string) $extension);

        return match ($ext) {
            'doc', 'docx', 'odt', 'rtf', 'pdf', 'txt', 'md', 'markdown' => 'document',
            'xls', 'xlsx', 'ods', 'csv', 'numbers' => 'spreadsheet',
            'ppt', 'pptx', 'odp', 'key' => 'presentation',
            'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp' => 'image',
            'mp3', 'wav', 'ogg', 'flac' => 'audio',
            'mp4', 'mov', 'avi', 'mkv', 'webm' => 'video',
            'zip', 'tar', 'gz', 'bz2', '7z', 'rar' => 'archive',
            'vcf' => 'contact',
            'ics' => 'calendar',
            default => 'file',
        };
    }

    /**
     * @return array{body: ?string, frontmatter: ?string}
     */
    private function readFileBodyForIndexing(
        string $key,
        ?string $extension,
        int $size,
        bool $isDirectory,
        bool $isNotePath = false,
    ): array {
        if ($isDirectory || ! in_array((string) $extension, self::FILE_BODY_EXTENSIONS, true)) {
            return ['body' => null, 'frontmatter' => null];
        }
        if ($size > self::MAX_INDEXED_BODY_BYTES) {
            return ['body' => null, 'frontmatter' => null];
        }

        $raw = $this->storage->files()->get($key);
        if (! is_string($raw) || $raw === '') {
            return ['body' => null, 'frontmatter' => null];
        }

        if (! mb_check_encoding($raw, 'UTF-8')) {
            $converted = @mb_convert_encoding($raw, 'UTF-8', 'UTF-8, ISO-8859-1, Windows-1252');
            if (! is_string($converted) || ! mb_check_encoding($converted, 'UTF-8')) {
                return ['body' => null, 'frontmatter' => null];
            }
            $raw = $converted;
        }

        [$content, $frontmatter] = $isNotePath
            ? $this->splitNotesFrontmatter($raw, $extension)
            : $this->splitMarkdownFrontmatter($raw, $extension);

        return [
            'body' => $this->normalizeBodyTextForIndexing($content, $extension),
            'frontmatter' => $frontmatter,
        ];
    }

    private function safeMimeType(string $key): ?string
    {
        try {
            $mime = $this->storage->files()->mimeType($key);

            return is_string($mime) && trim($mime) !== '' ? $mime : null;
        } catch (\Throwable) {
            return null;
        }
    }

    private function normalizeBodyTextForIndexing(string $raw, ?string $extension): string
    {
        $text = trim($raw);
        if ($text === '') {
            return '';
        }
        if ($extension !== 'md') {
            return $text;
        }

        $text = preg_replace('/```[a-z0-9_-]*\R?/i', '', $text) ?? $text;
        $text = preg_replace('/`([^`]+)`/', '$1', $text) ?? $text;
        $text = preg_replace('/!\[([^\]]*)\]\([^)]+\)/', '$1', $text) ?? $text;
        $text = preg_replace('/\[(.*?)\]\([^)]+\)/', '$1', $text) ?? $text;
        $text = preg_replace('/^>\s?/m', '', $text) ?? $text;
        $text = preg_replace('/^#{1,6}\s+/m', '', $text) ?? $text;
        $text = preg_replace('/^\s*[-*+]\s+/m', '', $text) ?? $text;
        $text = preg_replace('/^\s*\d+\.\s+/m', '', $text) ?? $text;
        $text = preg_replace('/(\*\*|__)(.*?)\1/', '$2', $text) ?? $text;
        $text = preg_replace('/(\*|_)(.*?)\1/', '$2', $text) ?? $text;
        $text = preg_replace('/~~(.*?)~~/', '$1', $text) ?? $text;
        $text = preg_replace('/\R{3,}/', "\n\n", $text) ?? $text;

        return trim($text);
    }

    /**
     * @return array{0: string, 1: ?string}
     */
    private function splitMarkdownFrontmatter(string $raw, ?string $extension): array
    {
        if ($extension !== 'md') {
            return [$raw, null];
        }
        if (! preg_match('/\A---\R(.*?)\R---\R?/s', $raw, $matches)) {
            return [$raw, null];
        }

        $block = (string) $matches[0];
        $frontmatter = trim((string) $matches[1]);

        return [substr($raw, strlen($block)) ?: '', $frontmatter !== '' ? $frontmatter : null];
    }

    /**
     * Notes markdown uses a simple frontmatter block ending with "----".
     *
     * @return array{0: string, 1: ?string}
     */
    private function splitNotesFrontmatter(string $raw, ?string $extension): array
    {
        if ($extension !== 'md') {
            return [$raw, null];
        }
        $normalized = str_replace(["\r\n", "\r"], "\n", $raw);
        $token = "\n----\n";
        $idx = strpos($normalized, $token);
        if ($idx === false) {
            return $this->splitMarkdownFrontmatter($normalized, $extension);
        }

        $header = trim(substr($normalized, 0, $idx));
        $body = substr($normalized, $idx + strlen($token));

        return [$body, $header !== '' ? $header : null];
    }

    private function isHiddenPath(string $key): bool
    {
        foreach (explode('/', trim($key, '/')) as $segment) {
            if ($segment !== '' && str_starts_with($segment, '.')) {
                return true;
            }
        }

        return false;
    }

    private function isNotePath(string $key): bool
    {
        $normalized = '/'.trim($key, '/');

        return str_contains($normalized, '/.notes/');
    }

    private function titleFromFrontmatter(?string $frontmatter): ?string
    {
        if (! is_string($frontmatter) || trim($frontmatter) === '') {
            return null;
        }
        if (! preg_match('/^\s*title\s*:\s*(.+)$/im', $frontmatter, $matches)) {
            return null;
        }

        $value = trim((string) $matches[1]);
        if ($value === '') {
            return null;
        }
        if (
            (str_starts_with($value, '"') && str_ends_with($value, '"'))
            || (str_starts_with($value, "'") && str_ends_with($value, "'"))
        ) {
            $value = substr($value, 1, -1);
        }

        $value = trim($value);

        return $value !== '' ? $value : null;
    }

    private function deleteFileLikeDocuments(string $storageKey): void
    {
        foreach (['file', 'note'] as $sourceType) {
            $this->store->delete($sourceType, $storageKey);
            $this->store->deletePrefix($sourceType, $storageKey);
        }
    }

    private function calendarSourceKeyFromPath(string $path): ?string
    {
        $parts = explode('/', $this->normalizeDavPath($path));
        if (count($parts) < 4 || $parts[0] !== 'calendars') {
            return null;
        }

        $objectUri = rawurldecode((string) array_pop($parts));
        $calendarUri = rawurldecode((string) array_pop($parts));
        $principal = rawurldecode(trim(implode('/', array_slice($parts, 1)), '/'));
        if ($principal === '' || $calendarUri === '' || $objectUri === '') {
            return null;
        }

        return $principal.'|'.$calendarUri.'|'.$objectUri;
    }

    private function cardSourceKeyFromPath(string $path): ?string
    {
        $parts = explode('/', $this->normalizeDavPath($path));
        if (count($parts) < 4 || $parts[0] !== 'addressbooks') {
            return null;
        }

        $cardUri = rawurldecode((string) array_pop($parts));
        $bookUri = rawurldecode((string) array_pop($parts));
        $principal = rawurldecode(trim(implode('/', array_slice($parts, 1)), '/'));
        if ($principal === '' || $bookUri === '' || $cardUri === '') {
            return null;
        }

        return $principal.'|'.$bookUri.'|'.$cardUri;
    }

    /**
     * @return array{title?: string, body?: string, location?: string, organizer?: string, attendees?: list<string>, categories?: list<string>}
     */
    private function extractCalendarSearchPayload(string $raw): array
    {
        try {
            $vobject = Reader::read($raw);
        } catch (\Throwable) {
            return ['body' => trim($raw)];
        }
        if (! $vobject instanceof VCalendar) {
            return ['body' => trim($raw)];
        }

        $target = null;
        foreach (['VEVENT', 'VTODO', 'VJOURNAL'] as $component) {
            if (isset($vobject->$component)) {
                $target = $vobject->$component;
                break;
            }
        }
        if ($target === null) {
            return ['body' => trim($raw)];
        }

        $summary = isset($target->SUMMARY) ? trim((string) $target->SUMMARY->getValue()) : null;
        $description = isset($target->DESCRIPTION) ? trim((string) $target->DESCRIPTION->getValue()) : null;
        $location = isset($target->LOCATION) ? trim((string) $target->LOCATION->getValue()) : null;
        $organizer = isset($target->ORGANIZER) ? trim((string) $target->ORGANIZER->getValue()) : null;
        $categories = [];
        if (isset($target->CATEGORIES)) {
            foreach ($target->CATEGORIES as $category) {
                $categories = array_merge($categories, $category->getParts());
            }
        }
        $attendees = [];
        if (isset($target->ATTENDEE)) {
            foreach ($target->ATTENDEE as $attendee) {
                $attendees[] = trim((string) $attendee->getValue());
            }
        }

        $bodyParts = array_filter([$summary, $description, $location, $organizer, implode(' ', $attendees), implode(' ', $categories)]);
        $payload = [
            'body' => trim(implode("\n", $bodyParts)),
            'attendees' => array_values(array_filter($attendees, static fn (string $v): bool => $v !== '')),
            'categories' => array_values(array_filter(array_map(static fn (mixed $value): string => trim((string) $value), $categories), static fn (string $v): bool => $v !== '')),
        ];
        if (is_string($summary) && $summary !== '') {
            $payload['title'] = $summary;
        }
        if (is_string($location) && $location !== '') {
            $payload['location'] = $location;
        }
        if (is_string($organizer) && $organizer !== '') {
            $payload['organizer'] = $organizer;
        }

        return $payload;
    }

    /**
     * @return array{
     *   fullName?: string,
     *   firstName?: string,
     *   lastName?: string,
     *   emails?: list<string>,
     *   phones?: list<string>,
     *   organization?: string,
     *   title?: string,
     *   note?: string,
     *   address?: list<string>,
     *   city?: string,
     *   country?: string
     * }
     */
    private function extractCardSearchPayload(string $raw): array
    {
        try {
            $vobject = Reader::read($raw);
        } catch (\Throwable) {
            return [];
        }
        if (! $vobject instanceof VCard) {
            return [];
        }

        $fullName = isset($vobject->FN) ? trim((string) $vobject->FN->getValue()) : null;
        $firstName = null;
        $lastName = null;
        if (isset($vobject->N)) {
            $parts = $vobject->N->getParts();
            $lastName = isset($parts[0]) ? trim((string) $parts[0]) : null;
            $firstName = isset($parts[1]) ? trim((string) $parts[1]) : null;
        }
        $emails = [];
        foreach ($vobject->select('EMAIL') as $email) {
            $emails[] = trim((string) $email->getValue());
        }
        $phones = [];
        foreach ($vobject->select('TEL') as $tel) {
            $phones[] = trim((string) $tel->getValue());
        }

        $addressParts = [];
        $city = null;
        $country = null;
        foreach ($vobject->select('ADR') as $adr) {
            $parts = $adr->getParts();
            $addressParts[] = trim(implode(' ', array_filter(array_map('trim', $parts))));
            if ($city === null && isset($parts[3])) {
                $city = trim((string) $parts[3]);
            }
            if ($country === null && isset($parts[6])) {
                $country = trim((string) $parts[6]);
            }
        }

        $organization = isset($vobject->ORG) ? trim((string) $vobject->ORG->getValue()) : null;
        $title = isset($vobject->TITLE) ? trim((string) $vobject->TITLE->getValue()) : null;
        $note = isset($vobject->NOTE) ? trim((string) $vobject->NOTE->getValue()) : null;
        $payload = [
            'emails' => array_values(array_filter($emails, static fn (string $v): bool => $v !== '')),
            'phones' => array_values(array_filter($phones, static fn (string $v): bool => $v !== '')),
            'address' => array_values(array_filter($addressParts, static fn (string $v): bool => $v !== '')),
        ];
        if (is_string($fullName)) {
            $payload['fullName'] = $fullName;
        }
        if (is_string($firstName)) {
            $payload['firstName'] = $firstName;
        }
        if (is_string($lastName)) {
            $payload['lastName'] = $lastName;
        }
        if (is_string($organization)) {
            $payload['organization'] = $organization;
        }
        if (is_string($title)) {
            $payload['title'] = $title;
        }
        if (is_string($note)) {
            $payload['note'] = $note;
        }
        if (is_string($city)) {
            $payload['city'] = $city;
        }
        if (is_string($country)) {
            $payload['country'] = $country;
        }

        return $payload;
    }

    private function principalFromUri(string $principalUri): ?string
    {
        if (! str_starts_with($principalUri, 'principals/')) {
            return null;
        }

        $username = trim(substr($principalUri, strlen('principals/')));

        return $username !== '' ? $username : null;
    }
}
