<?php

declare(strict_types=1);

namespace App\Dav\Storage;

use Sabre\DAV;
use Sabre\DAV\PartialUpdate\IPatchSupport;

class FlysystemFile extends FlysystemNode implements DAV\IFile, IPatchSupport
{
    /**
     * @param  resource|string  $data
     */
    public function put($data): string
    {
        $this->filesystem->put($this->key, $data);

        return (string) $this->getETag();
    }

    /**
     * @param  resource|string  $data
     */
    public function patch($data, $rangeType, $offset = null): ?string
    {
        $path = $this->filesystem->path($this->key);
        switch ($rangeType) {
            case 2:
                $f = fopen($path, 'c');
                if ($f === false) {
                    break;
                }
                fseek($f, (int) $offset);
                break;
            case 3:
                $f = fopen($path, 'c');
                if ($f === false) {
                    break;
                }
                fseek($f, (int) $offset, SEEK_END);
                break;
            case 1:
            default:
                $f = fopen($path, 'a');
                break;
        }
        if (! isset($f) || $f === false) {
            return $this->put($data);
        }
        if (is_string($data)) {
            fwrite($f, $data);
        } else {
            stream_copy_to_stream($data, $f);
        }
        fclose($f);

        return (string) $this->getETag();
    }

    public function get()
    {
        $stream = $this->filesystem->readStream($this->key);
        if (! is_resource($stream)) {
            throw new DAV\Exception\NotFound('File could not be located');
        }

        return $stream;
    }

    public function delete(): bool
    {
        return $this->filesystem->delete($this->key);
    }

    public function getETag(): ?string
    {
        if (! $this->filesystem->fileExists($this->key)) {
            return null;
        }

        $mtime = $this->filesystem->lastModified($this->key);
        $size = $this->filesystem->size($this->key);

        return '"'.sha1($this->key.':'.(int) $mtime.':'.(int) $size).'"';
    }

    public function getContentType(): ?string
    {
        return null;
    }

    public function getSize(): int
    {
        return (int) ($this->filesystem->size($this->key) ?? 0);
    }
}
