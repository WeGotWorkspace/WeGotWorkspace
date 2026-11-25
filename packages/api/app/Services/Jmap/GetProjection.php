<?php

declare(strict_types=1);

namespace App\Services\Jmap;

/**
 * The `properties` argument of a /get call (RFC 8620 §5.1), parsed once.
 *
 * Every /get method builds one of these before it loads anything, and calls
 * {@see apply()} on each record the moment it is mapped. The method never holds
 * the full records of a page, so peak memory stays flat from 500 to 2000
 * records. {@see wants()} lets a method skip work only a dropped property needs
 * (FileNode's on-disk type sniff, for one).
 */
final class GetProjection
{
    /**
     * @param  array<string, true>|null  $keep  null means "every property"
     */
    private function __construct(private readonly ?array $keep) {}

    /**
     * @param  array<string, mixed>  $args
     *
     * @throws JmapMethodException invalidArguments for a malformed `properties`
     */
    public static function fromArgs(array $args): self
    {
        $properties = $args['properties'] ?? null;
        if ($properties === null) {
            return new self(null);
        }
        if (! is_array($properties) || ! array_is_list($properties)) {
            throw new JmapMethodException('invalidArguments', 'properties must be null or an array of property names.');
        }

        // The id property is always returned (RFC 8620 §5.1).
        $keep = ['id' => true];
        foreach ($properties as $property) {
            if (! is_string($property)) {
                throw new JmapMethodException('invalidArguments', 'properties must contain strings.');
            }
            $keep[$property] = true;
        }

        return new self($keep);
    }

    public static function all(): self
    {
        return new self(null);
    }

    /** Is $property part of the response? Always true without a `properties` argument. */
    public function wants(string $property): bool
    {
        return $this->keep === null || isset($this->keep[$property]);
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array<string, mixed>
     */
    public function apply(array $record): array
    {
        return $this->keep === null ? $record : array_intersect_key($record, $this->keep);
    }
}
