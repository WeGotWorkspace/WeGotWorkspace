<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Dav\Storage\FlysystemAclCollection;
use App\Dav\Storage\FlysystemFile;
use Illuminate\Contracts\Filesystem\Filesystem;

final class GroupSharedCollection extends FlysystemAclCollection
{
    public function __construct(
        Filesystem $filesystem,
        string $key,
        private readonly string $groupPrincipalUri,
    ) {
        parent::__construct($filesystem, $key, [], $groupPrincipalUri);
    }

    /**
     * @return list<array{privilege: string, principal: string, protected?: bool}>
     */
    public function getACL(): array
    {
        return GroupSharedAclHelper::aclForGroup($this->groupPrincipalUri);
    }

    protected function makeChildDirectory(string $key): self
    {
        return new self($this->filesystem, $key, $this->groupPrincipalUri);
    }

    protected function makeChildFile(string $key): FlysystemFile
    {
        return new GroupSharedFile($this->filesystem, $key, $this->groupPrincipalUri);
    }
}
