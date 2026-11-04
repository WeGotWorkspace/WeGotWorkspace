<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

/**
 * Expected result of one ownership matrix case.
 */
enum Outcome: string
{
    /** The operation succeeds (2xx, or the object appears in a JMAP get/set result). */
    case Allowed = 'allowed';

    /** REST 404 `not_found`, or JMAP `notFound` / `notUpdated` / `notDestroyed` with type `notFound`. */
    case NotFound = 'not-found';

    /** REST 403, or JMAP set error type `forbidden`. The error code defaults to `forbidden`. */
    case Forbidden = 'forbidden';

    /** A sharee "delete" that removes only the grant; the owner's object stays. */
    case Dismissed = 'dismissed';

    /** JMAP method error `accountNotFound` for a foreign accountId. */
    case AccountNotFound = 'account-not-found';

    /** REST 400 `bad_request`, or JMAP set error type `invalidProperties`: the request names a target the endpoint refuses outright. */
    case Rejected = 'rejected';

    /** REST 409. The error code is checked only when one is given. JMAP set error type `alreadyExists`. */
    case Conflict = 'conflict';

    /** REST 401 without a usable token. */
    case Unauthenticated = 'unauthenticated';

    /** REST 410 (expired link or invite). */
    case Gone = 'gone';

    /** REST 401 `share_password_required`. */
    case PasswordRequired = 'password-required';

    /** REST 401 `share_password_invalid`. */
    case PasswordInvalid = 'password-invalid';
}
