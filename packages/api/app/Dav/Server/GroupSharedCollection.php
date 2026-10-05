<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Dav\Storage\FlysystemAclCollection;
use App\Dav\Storage\FlysystemFile;
use Illuminate\Contracts\Filesystem\Filesystem;

final class GroupSharedCollection extends FlysystemAclCollection
{
    /**
     * @param  list<array{privilege: string, principal: string, protected?: bool}>|null  $acl
     */
    public function __construct(
        Filesystem $filesystem,
        string $key,
        private readonly string $groupPrincipalUri,
        ?array $acl = null,
    ) {
        parent::__construct(
            $filesystem,
            $key,
            $acl ?? GroupSharedAclHelper::aclForGroup($groupPrincipalUri),
            $groupPrincipalUri,
        );
    }

    protected function makeDirectoryNode(string $key): FlysystemAclCollection
    {
        return new self($this->filesystem, $key, $this->groupPrincipalUri, $this->acl);
    }

    protected function makeFileNode(string $key): FlysystemFile
    {
        return new GroupSharedFile($this->filesystem, $key, $this->groupPrincipalUri, $this->acl);
    }
}
