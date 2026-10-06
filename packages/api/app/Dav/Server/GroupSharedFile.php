<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Dav\Storage\FlysystemAclFile;
use Illuminate\Contracts\Filesystem\Filesystem;

final class GroupSharedFile extends FlysystemAclFile
{
    /**
     * @param  list<array{privilege: string, principal: string, protected?: bool}>|null  $acl
     */
    public function __construct(
        Filesystem $filesystem,
        string $key,
        string $groupPrincipalUri,
        ?array $acl = null,
    ) {
        parent::__construct(
            $filesystem,
            $key,
            $acl ?? GroupSharedAclHelper::aclForGroup($groupPrincipalUri),
            $groupPrincipalUri,
        );
    }
}
