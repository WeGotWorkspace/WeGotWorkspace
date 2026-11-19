<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

/** PATCH /threads/{subjectType}/{subjectId}/entries/{entryId} (#2173). */
final class ThreadEntryPatchRequest extends FormRequest
{
    use NarrowsValidatedInput;

    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'body' => ['required', 'string', 'min:1'],
        ];
    }

    public function body(): string
    {
        return $this->requiredString($this->validated()['body'] ?? null);
    }
}
