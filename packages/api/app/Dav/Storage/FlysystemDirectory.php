<?php

declare(strict_types=1);

namespace App\Dav\Storage;

use App\Services\Drive\DocAttachmentPaths;
use Sabre\DAV;

class FlysystemDirectory extends FlysystemNode implements DAV\ICollection, DAV\IMoveTarget, DAV\IQuota
{
    /**
     * @param  resource|string|null  $data
     */
    public function createFile($name, $data = null): ?string
    {
        if ($name === '.' || $name === '..') {
            throw new DAV\Exception\Forbidden('Permission denied to . and ..');
        }
        $key = $this->childKey($name);
        $this->filesystem->put($key, $data ?? '');

        return '"'.sha1($key.':'.time()).'"';
    }

    public function createDirectory($name): void
    {
        if ($name === '.' || $name === '..') {
            throw new DAV\Exception\Forbidden('Permission denied to . and ..');
        }
        $this->filesystem->makeDirectory($this->childKey($name));
    }

    public function getChild($name): DAV\INode
    {
        if ($name === '.' || $name === '..') {
            throw new DAV\Exception\Forbidden('Permission denied to . and ..');
        }
        $key = $this->childKey($name);
        if ($this->filesystem->directoryExists($key)) {
            return new self($this->filesystem, $key);
        }
        if ($this->filesystem->fileExists($key)) {
            return new FlysystemFile($this->filesystem, $key);
        }

        throw new DAV\Exception\NotFound('File could not be located');
    }

    public function childExists($name): bool
    {
        if ($name === '.' || $name === '..') {
            throw new DAV\Exception\Forbidden('Permission denied to . and ..');
        }
        $key = $this->childKey($name);

        return $this->filesystem->directoryExists($key) || $this->filesystem->fileExists($key);
    }

    /**
     * @return list<DAV\INode>
     */
    public function getChildren(): array
    {
        $nodes = [];
        $prefix = $this->key === '' ? '' : $this->key.'/';
        foreach ($this->filesystem->directories($this->key) as $dirKey) {
            $name = substr($dirKey, strlen($prefix));
            if ($name === DocAttachmentPaths::DIR) {
                continue;
            }
            if ($name !== '' && $name !== '.' && $name !== '..') {
                $nodes[] = new self($this->filesystem, $dirKey);
            }
        }
        foreach ($this->filesystem->files($this->key) as $fileKey) {
            $name = substr($fileKey, strlen($prefix));
            if ($name === DocAttachmentPaths::DIR) {
                continue;
            }
            if ($name !== '' && $name !== '.' && $name !== '..') {
                $nodes[] = new FlysystemFile($this->filesystem, $fileKey);
            }
        }

        return $nodes;
    }

    public function delete(): bool
    {
        foreach ($this->getChildren() as $child) {
            $child->delete();
        }

        return $this->filesystem->deleteDirectory($this->key);
    }

    /**
     * @return array{0: int|float, 1: int|float}
     */
    public function getQuotaInfo(): array
    {
        $root = $this->filesystem->path($this->key === '' ? '.' : $this->key);
        $total = disk_total_space($root);
        $free = disk_free_space($root);
        if ($total === false || $free === false) {
            return [0, 0];
        }

        return [$total - $free, $free];
    }

    public function moveInto($targetName, $sourcePath, DAV\INode $sourceNode): bool
    {
        if (! $sourceNode instanceof FlysystemNode) {
            return false;
        }

        $targetKey = $this->childKey($targetName);
        if ($this->filesystem->directoryExists($sourceNode->key)) {
            return $this->filesystem->move($sourceNode->key, $targetKey);
        }
        if ($this->filesystem->fileExists($sourceNode->key)) {
            return $this->filesystem->move($sourceNode->key, $targetKey);
        }

        return false;
    }
}
