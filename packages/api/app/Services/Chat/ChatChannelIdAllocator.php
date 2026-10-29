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
 * still only depends on channels the caller can see:
 *
 * - a client id of a channel the caller can see is a 409;
 * - a client id only out-of-reach channels use is not kept: the channel gets
 *   a fresh id, and the response carries it;
 * - `chat-grp-` ids are reserved for group default channels
 *   (ChatCollectionUris::groupDefaultUri) and are refused for every caller;
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
        $prefix = ChatCollectionUris::PREFIX_CHANNEL;
        // Only chat- ids: dm- uris are exclusively minted by openDm's hash.
        if (! str_starts_with($requestedId, $prefix)) {
            throw new ApiHttpException(400, 'Channel id must start with "'.$prefix.'" for this kind.', 'invalidProperties', ['id']);
        }
        if (str_starts_with(strtolower($requestedId), self::RESERVED_GROUP_PREFIX)) {
            throw new ApiHttpException(400, 'Channel ids starting with "'.self::RESERVED_GROUP_PREFIX.'" are reserved.', 'invalidProperties', ['id']);
        }
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
