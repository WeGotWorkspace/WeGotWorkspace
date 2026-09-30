<?php

declare(strict_types=1);

namespace Tests\Support\Update;

final class TempTree
{
    public static function remove(string $path): void
    {
        if (is_file($path) || is_link($path)) {
            @unlink($path);

            return;
        }
        if (! is_dir($path)) {
            return;
        }
        $items = scandir($path);
        if (! is_array($items)) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            self::remove($path.'/'.$item);
        }
        @rmdir($path);
    }
}
