<?php

declare(strict_types=1);

namespace App\Http\Requests\Api\V1;

use App\Services\Rtc\Signaling\RtcNetClass;
use Illuminate\Foundation\Http\FormRequest;

final class RtcSessionMetricRequest extends FormRequest
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
            'channel' => ['required', 'string', 'in:meet,collab'],
            'joinMs' => ['sometimes', 'integer', 'min:0', 'max:600000'],
            'candidateType' => ['sometimes', 'string', 'in:host,srflx,prflx,relay'],
            'failedPairs' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'iceRestarts' => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'httpFallback' => ['sometimes', 'boolean'],
            'pollRttMs' => ['sometimes', 'integer', 'min:0', 'max:600000'],
            'net' => ['sometimes', 'string', 'in:'.implode(',', RtcNetClass::KNOWN)],
        ];
    }
}
