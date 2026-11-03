<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

/**
 * How the actor relates to the target object. Ids match the spec in
 * .agents/specs/000-ad-hoc-ownership-matrix/spec.md.
 */
enum Scope: string
{
    // Ownership
    case OwnUser = 'own-user';
    case OwnGroup = 'own-group';
    case OtherUser = 'other-user';
    case OtherGroup = 'other-group';
    case FormerGroup = 'former-group';

    // Grants to an internal user
    case UserToActorRead = 'user-to-actor-read';
    case UserToActorWrite = 'user-to-actor-write';
    case GroupToNonmemberRead = 'group-to-nonmember-read';
    case GroupToNonmemberWrite = 'group-to-nonmember-write';
    case UserToActorGroup = 'user-to-actor-group';
    case GrantRevoked = 'grant-revoked';
    case GrantDismissed = 'grant-dismissed';

    // Public capability tokens
    case CalendarFeed = 'calendar-feed';
    case LinkOpen = 'link-open';
    case LinkPassword = 'link-password';
    case LinkExpired = 'link-expired';
    case LinkRevoked = 'link-revoked';
    case EmailInvite = 'email-invite';
    case Rsvp = 'rsvp';

    // No target object (role-only cases such as a guest JWT on a user route)
    case None = 'none';

    /**
     * Scopes where the actor must not see the target at all.
     *
     * @return list<self>
     */
    public static function invisible(): array
    {
        return [self::OtherUser, self::OtherGroup, self::FormerGroup, self::GrantRevoked, self::GrantDismissed];
    }
}
