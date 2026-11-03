<?php

declare(strict_types=1);

namespace App\Services\Drive\FolderZip;

use App\Services\Jmap\FileNodes\FileNodeMapper;

/**
 * The read check for every node a folder zip touches (#1621): the same
 * `mayRead` the FileNode envelope reports.
 *
 * Not final: today a readable folder never holds an unreadable subfolder
 * (the most specific share grant wins and no access level removes reading),
 * so feature tests swap in a stricter check to prove such a subtree is left
 * out.
 */
class FolderZipReadCheck
{
    public function __construct(private readonly FileNodeMapper $mapper) {}

    /**
     * @param  array{username: string, role: string}  $principal
     */
    public function mayRead(string $key, array $principal): bool
    {
        return $this->mapper->rightsFor($key, $principal)['mayRead'];
    }
}
