<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

final class UnifiedSearchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'q' => ['sometimes', 'string', 'min:2', 'max:512'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:100'],
            'offset' => ['sometimes', 'integer', 'min:0'],
            'sources' => ['sometimes', 'array'],
            'sources.*' => ['string', Rule::in(['file', 'note', 'caldav', 'carddav'])],
            'categories' => ['sometimes', 'array'],
            'categories.*' => ['string', 'min:1', 'max:64'],
            'extensions' => ['sometimes', 'array'],
            'extensions.*' => ['string', 'min:1', 'max:32'],
            'modified_from' => ['sometimes', 'string', 'date'],
            'modified_to' => ['sometimes', 'string', 'date'],
            'path_prefix' => ['sometimes', 'string', 'min:1', 'max:512'],
        ];
    }

    protected function prepareForValidation(): void
    {
        $merge = [
            'sources' => $this->normalizeListParam($this->input('sources')),
            'categories' => $this->normalizeListParam($this->input('categories')),
            'extensions' => array_map(
                static fn (string $value): string => strtolower($value),
                $this->normalizeListParam($this->input('extensions'))
            ),
        ];
        $pathPrefix = $this->input('path_prefix');
        if (is_string($pathPrefix)) {
            $normalized = trim($pathPrefix);
            $normalized = trim($normalized, '/');
            if ($normalized !== '') {
                $merge['path_prefix'] = $normalized;
            }
        }
        $this->merge($merge);
    }

    /**
     * @return list<string>
     */
    private function normalizeListParam(mixed $value): array
    {
        if (is_string($value)) {
            $parts = preg_split('/\s*,\s*/', trim($value)) ?: [];

            return array_values(array_filter(array_map('trim', $parts), static fn (string $v): bool => $v !== ''));
        }
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(static fn (mixed $item): string => is_string($item) ? trim($item) : '', $value),
            static fn (string $v): bool => $v !== ''
        ));
    }

    /**
     * Browse mode lets the client omit `q` to list documents: `extensions` must be
     * non-empty AND every requested source must be `file` (omitted sources, which
     * default to all sources, do not qualify).
     */
    public function isBrowseMode(): bool
    {
        $extensions = $this->input('extensions');
        if (! is_array($extensions) || $extensions === []) {
            return false;
        }
        $sources = $this->input('sources');
        if (! is_array($sources) || $sources === []) {
            return false;
        }

        foreach ($sources as $source) {
            if ($source !== 'file') {
                return false;
            }
        }

        return true;
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if (! $this->isBrowseMode()) {
                $q = $this->input('q');
                if (! is_string($q) || trim($q) === '') {
                    $validator->errors()->add('q', 'The q field is required unless browsing by extension.');
                }
            }

            $fromRaw = $this->input('modified_from');
            $toRaw = $this->input('modified_to');
            if (! is_string($fromRaw) || ! is_string($toRaw)) {
                return;
            }
            $from = strtotime($fromRaw);
            $to = strtotime($toRaw);
            if (! is_int($from) || ! is_int($to)) {
                return;
            }
            if ($to < $from) {
                $validator->errors()->add('modified_to', 'The modified_to must be greater than or equal to modified_from.');
            }
        });
    }
}
