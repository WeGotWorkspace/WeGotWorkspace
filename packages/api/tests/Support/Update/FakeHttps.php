<?php

declare(strict_types=1);

namespace Tests\Support\Update;

/**
 * In-process HTTPS stand-in for updater feed and package downloads.
 */
final class FakeHttps
{
    /** @var array<string, string> */
    public static array $bodies = [];

    /**
     * Response header lines per URL, including Content-Length when a test
     * needs the incomplete-download branch.
     *
     * @var array<string, list<string>>
     */
    public static array $headers = [];

    private static bool $installed = false;

    /** @var resource|null */
    private $buffer;

    public mixed $context = null;

    /** @var list<string>|null */
    public ?array $wrapper_data = null;

    public static function install(): void
    {
        if (self::$installed) {
            return;
        }
        stream_wrapper_unregister('https');
        stream_wrapper_register('https', self::class);
        self::$installed = true;
    }

    public static function remove(): void
    {
        if (! self::$installed) {
            return;
        }
        stream_wrapper_unregister('https');
        stream_wrapper_restore('https');
        self::$installed = false;
        self::$bodies = [];
        self::$headers = [];
    }

    public function stream_open(string $path, string $mode, int $options, ?string &$opened_path): bool
    {
        if (! isset(self::$bodies[$path])) {
            return false;
        }
        $buffer = fopen('php://memory', 'rb+');
        if ($buffer === false) {
            return false;
        }
        fwrite($buffer, self::$bodies[$path]);
        rewind($buffer);
        $this->buffer = $buffer;
        $this->wrapper_data = self::$headers[$path] ?? null;

        return true;
    }

    public function stream_read(int $count): string
    {
        if (! is_resource($this->buffer)) {
            return '';
        }
        $chunk = fread($this->buffer, $count);

        return is_string($chunk) ? $chunk : '';
    }

    public function stream_eof(): bool
    {
        return ! is_resource($this->buffer) || feof($this->buffer);
    }

    public function stream_tell(): int
    {
        if (! is_resource($this->buffer)) {
            return 0;
        }

        return (int) ftell($this->buffer);
    }

    public function stream_seek(int $offset, int $whence = SEEK_SET): bool
    {
        return is_resource($this->buffer) && fseek($this->buffer, $offset, $whence) === 0;
    }

    public function stream_stat(): array|false
    {
        if (! is_resource($this->buffer)) {
            return false;
        }
        $stat = fstat($this->buffer);

        return is_array($stat) ? $stat : false;
    }

    /**
     * @return array<string, int>|false
     */
    public function url_stat(string $path, int $flags): array|false
    {
        if (! isset(self::$bodies[$path])) {
            return false;
        }

        return self::statArray(strlen(self::$bodies[$path]));
    }

    public function stream_set_option(int $option, int $arg1, int $arg2): bool
    {
        return true;
    }

    public function stream_close(): void
    {
        if (is_resource($this->buffer)) {
            fclose($this->buffer);
        }
        $this->buffer = null;
    }

    /**
     * @return array<string, int>
     */
    private static function statArray(int $size): array
    {
        return [
            'dev' => 0,
            'ino' => 0,
            'mode' => 0100644,
            'nlink' => 1,
            'uid' => 0,
            'gid' => 0,
            'rdev' => 0,
            'size' => $size,
            'atime' => 0,
            'mtime' => 0,
            'ctime' => 0,
            'blksize' => 4096,
            'blocks' => (int) ceil($size / 512),
        ];
    }
}
