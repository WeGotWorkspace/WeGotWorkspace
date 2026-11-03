<?php

declare(strict_types=1);

namespace App\Services\Drive\FolderZip;

/** Thrown by a zip response sink when the client disconnected (#1621). */
final class FolderZipAborted extends \RuntimeException {}
