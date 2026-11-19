<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Http\Requests\Api\V1\Concerns\NarrowsValidatedInput;
use Illuminate\Foundation\Http\FormRequest;

/** POST /threads/{subjectType}/{subjectId}/entries/{entryId}/reactions (#2173). */
final class ThreadReactionRequest extends FormRequest
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
            'emoji' => ['required', 'string', 'min:1', 'max:64'],
        ];
    }

    public function emoji(): string
    {
        return $this->requiredString($this->validated()['emoji'] ?? null);
    }
}
