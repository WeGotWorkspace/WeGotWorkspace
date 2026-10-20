<?php

declare(strict_types=1);

namespace App\Services\Installer;

/**
 * A typed data directory was refused. The installer returns {@see $errorCode}
 * as `error_code`, so the page can tell which rejection it got without
 * matching the message text.
 */
final class DataDirRejected extends \RuntimeException
{
    public const NOT_ABSOLUTE = 'data_dir_not_absolute';

    public const PARENT_MISSING = 'data_dir_parent_missing';

    public const PUBLISHED = 'data_dir_published';

    public const NOT_WRITABLE = 'data_dir_not_writable';

    public const OWNED = 'data_dir_owned';

    private function __construct(public readonly string $errorCode, string $message)
    {
        parent::__construct($message);
    }

    public static function notAbsolute(): self
    {
        return new self(self::NOT_ABSOLUTE, 'Enter an absolute path for the data directory.');
    }

    public static function parentMissing(): self
    {
        return new self(self::PARENT_MISSING, 'The parent of that data directory does not exist.');
    }

    public static function published(): self
    {
        return new self(self::PUBLISHED, 'That directory is inside the published website. Choose a folder outside it.');
    }

    public static function notWritable(): self
    {
        return new self(self::NOT_WRITABLE, 'That directory is not writable by the web server.');
    }

    public static function owned(): self
    {
        return new self(self::OWNED, 'That directory belongs to another installation.');
    }
}
