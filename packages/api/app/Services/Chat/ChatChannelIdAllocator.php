<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use Closure;
use Illuminate\Support\Str;

/**
 * Picks the id (collection uri) of a new `chat-` channel.
 *
 * Channel ids are unique across the instance, so every member addresses the
 * same id (sharee instances are normalized onto it). The answer to a create
 * must not tell the caller which ids other people's channels use:
 *
 * - a client id must be `chat-` plus a ULID or UUID, so an id taken
 *   elsewhere cannot be guessed; any other shape (a readable slug, the
 *   reserved `chat-grp-` group default prefix) is refused for every caller;
 * - a client id of a channel the caller can see is a 409;
 * - a client id only out-of-reach channels use is not kept: the channel gets
 *   a fresh id, and the response carries it;
 * - without a client id, the id is the slug of the initial name plus a short
 *   random suffix, so it never reflects which names other channels use.
 *
 * Meeting ids (`chat-{room code}`) are not allocated here.
 */
final class ChatChannelIdAllocator
{
    public const RESERVED_GROUP_PREFIX = ChatCollectionUris::PREFIX_CHANNEL.'grp-';

    private const SLUG_MAX_LENGTH = 48;

    private const SUFFIX_LENGTH = 6;

    /**
     * @param  Closure(string): bool  $visibleToCaller  true when the caller can see the channel with this id
     */
    public function allocate(?string $requestedId, string $name, Closure $visibleToCaller): string
    {
        if ($requestedId !== null && $requestedId !== '') {
            return $this->clientId($requestedId, $visibleToCaller);
        }

        return $this->fromName($name);
    }

    /**
     * @param  Closure(string): bool  $visibleToCaller
     */
    private function clientId(string $requestedId, Closure $visibleToCaller): string
    {
        // Only chat- ids: dm- uris are exclusively minted by openDm's hash.
        $suffix = str_starts_with($requestedId, ChatCollectionUris::PREFIX_CHANNEL)
            ? substr($requestedId, strlen(ChatCollectionUris::PREFIX_CHANNEL))
            : '';
        if (! Str::isUlid($suffix) && ! Str::isUuid($suffix)) {
            throw new ApiHttpException(400, 'Channel id must be "'.ChatCollectionUris::PREFIX_CHANNEL.'" followed by a ULID or UUID.', 'invalidProperties', ['id']);
        }
        $requestedId = strtolower($requestedId);
        if (! $this->taken($requestedId)) {
            return $requestedId;
        }
        if ($visibleToCaller($requestedId)) {
            throw new ApiHttpException(409, 'Channel id already exists.', 'alreadyExists');
        }

        return $this->freshUlidId();
    }

    private function fromName(string $name): string
    {
        // Readable ids: the slug of the *initial* name. Renames only change the
        // displayname, the id never moves. Names that slug to nothing, or to
        // the reserved group prefix, fall back to a ULID.
        $slug = trim(Str::substr(Str::slug(Str::substr($name, 0, self::SLUG_MAX_LENGTH)), 0, self::SLUG_MAX_LENGTH), '-');
        $base = ChatCollectionUris::PREFIX_CHANNEL.$slug.'-';
        if ($slug === '' || str_starts_with($base, self::RESERVED_GROUP_PREFIX)) {
            return $this->freshUlidId();
        }

        do {
            $candidate = $base.$this->randomSuffix();
        } while ($this->taken($candidate));

        return $candidate;
    }

    private function freshUlidId(): string
    {
        do {
            $candidate = ChatCollectionUris::channelUri((string) Str::ulid());
        } while ($this->taken($candidate));

        return $candidate;
    }

    private function randomSuffix(): string
    {
        // Crockford base32, lowercase: no ambiguous characters.
        $alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
        $suffix = '';
        for ($i = 0; $i < self::SUFFIX_LENGTH; $i++) {
            $suffix .= $alphabet[random_int(0, strlen($alphabet) - 1)];
        }

        return $suffix;
    }

    private function taken(string $uri): bool
    {
        return CalendarInstance::query()->where('uri', $uri)->exists();
    }
}
