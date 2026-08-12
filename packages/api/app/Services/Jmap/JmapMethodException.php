<?php

declare(strict_types=1);

namespace App\Services\Jmap;

/**
 * Method-level JMAP error (RFC 8620 §3.6.2): rendered by the dispatcher as
 * an `["error", {type, description?, ...}, callId]` invocation, never as a
 * non-2xx HTTP response.
 */
final class JmapMethodException extends \RuntimeException
{
    /**
     * @param  array<string, mixed>  $extra
     */
    public function __construct(
        private readonly string $type,
        ?string $description = null,
        private readonly array $extra = [],
    ) {
        parent::__construct($description ?? '');
    }

    /**
     * @return array<string, mixed>
     */
    public function errorArgs(): array
    {
        $args = ['type' => $this->type];
        if ($this->getMessage() !== '') {
            $args['description'] = $this->getMessage();
        }

        return array_merge($args, $this->extra);
    }
}
