<?php

declare(strict_types=1);

namespace Tests\Support\Ownership;

/**
 * Why an operation has no ownership rows.
 */
enum ExemptionReason: string
{
    /** Acts on other users, groups, or the instance by design; the role gate is covered by RoleAccessMatrixTest. */
    case AdminTarget = 'admin-target';

    /** Authorized by a capability token; covered by the public scopes instead of the ownership columns. */
    case PublicToken = 'public-token';

    /** Acts only on the caller's own account and takes no object id. */
    case SelfOnly = 'self';

    /** Reads or writes no per-object data. */
    case NoObject = 'no-object';

    /** The JMAP HTTP envelope; each method behind it is declared as its own "JMAP <name>" operation. */
    case JmapEnvelope = 'jmap-envelope';
}
