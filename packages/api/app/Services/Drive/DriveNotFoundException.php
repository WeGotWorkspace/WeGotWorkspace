<?php

declare(strict_types=1);

namespace App\Services\Drive;

/** The drive path is reachable for the caller but names no file or directory. REST answers 404. */
final class DriveNotFoundException extends \InvalidArgumentException {}
