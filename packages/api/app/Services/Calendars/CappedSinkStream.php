<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use GuzzleHttp\Psr7\StreamDecoratorTrait;
use Psr\Http\Message\StreamInterface;

/**
 * Sink that stops accepting bytes once the cap is crossed.
 * A short write makes cURL abort with CURLE_WRITE_ERROR.
 */
final class CappedSinkStream implements StreamInterface
{
    use StreamDecoratorTrait;

    public bool $tooLarge = false;

    private int $written = 0;

    public function __construct(private StreamInterface $stream, private int $cap) {}

    public function write($string): int
    {
        if ($this->written + strlen($string) > $this->cap) {
            $this->tooLarge = true;

            return 0;
        }

        $this->written += strlen($string);

        return $this->stream->write($string);
    }
}
